import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgresql://u:p@h:5432/d' };
const k = (c: string) => c.repeat(40);

describe('signing keys on the live server (06.11.2026)', () => {
  it('refuses short, example or shared keys in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short123', JWT_REFRESH_SECRET: k('b') })).toThrow('32+');
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'CHANGE_ME' + k('a'), JWT_REFRESH_SECRET: k('b') })).toThrow('32+');
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: k('a'), JWT_REFRESH_SECRET: k('a') })).toThrow('must differ');
    expect(validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: k('a'), JWT_REFRESH_SECRET: k('b') }).NODE_ENV).toBe('production');
  });

  it('leaves development as it was', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'development', JWT_ACCESS_SECRET: 'devsecret', JWT_REFRESH_SECRET: 'devsecret' }).NODE_ENV).toBe('development');
  });
});
