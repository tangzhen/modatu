/**
 * 跨数据库便携列类型。
 * PostgreSQL 不支持 `datetime`，sqlite/sqljs 不支持 `timestamp`——
 * 按运行模式（MODATU_DB=sqljs 为测试内存库）选择正确的时间戳类型。
 */
export const PORTABLE_TIMESTAMP: 'timestamp' | 'datetime' =
  process.env['MODATU_DB'] === 'sqljs' ? 'datetime' : 'timestamp';
