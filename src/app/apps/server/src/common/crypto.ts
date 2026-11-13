import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 静态加密（AES-256-GCM），用于用户 LLM API Key 等落盘敏感数据（spec-06）。
 * 密文格式：v1.<iv>.<tag>.<ciphertext>（均 base64url）。
 */

const keyCache = new Map<string, Buffer>();

function deriveKey(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = createHash('sha256').update(secret).digest();
    keyCache.set(secret, key);
  }
  return key;
}

export function encryptString(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

/** 解密；密文格式不符或校验失败返回 null（视为未配置），绝不抛出。 */
export function decryptString(cipherText: string | null | undefined, secret: string): string | null {
  if (!cipherText) return null;
  const parts = cipherText.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const ct = Buffer.from(parts[3]!, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** API Key 掩码回显（前端永不明文回显，spec-06）。 */
export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
