import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { SearchParamsDto } from './search-params.dto';

/** A4：temperature 越界值 422 的校验层断言 */
describe('SearchParamsDto temperature 校验（A4）', () => {
  const base = { topK: 10 };

  it('合法温度 0 / 0.1 / 2 通过', async () => {
    for (const temperature of [0, 0.1, 2]) {
      const errors = await validate(Object.assign(new SearchParamsDto(), { ...base, temperature }));
      expect(errors).toHaveLength(0);
    }
  });

  it('越界温度 -0.1 / 2.1 / 非数值 被拒绝', async () => {
    for (const temperature of [-0.1, 2.1, 'hot' as unknown as number]) {
      const errors = await validate(Object.assign(new SearchParamsDto(), { ...base, temperature }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'temperature')).toBe(true);
    }
  });

  it('缺省 temperature 合法（可选字段）', async () => {
    const errors = await validate(Object.assign(new SearchParamsDto(), base));
    expect(errors).toHaveLength(0);
  });

  it('既有字段约束不受影响（rrfK 越界仍被拒）', async () => {
    const errors = await validate(Object.assign(new SearchParamsDto(), { ...base, rrfK: 500 }));
    expect(errors.some((e) => e.property === 'rrfK')).toBe(true);
  });
});
