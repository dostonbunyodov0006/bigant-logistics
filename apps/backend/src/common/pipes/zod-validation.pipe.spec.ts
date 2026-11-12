import { BadRequestException } from '@nestjs/common';
import { deliverOrderSchema, loginSchema } from '@bigant/shared';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(loginSchema);

  it('returns parsed data for valid input', () => {
    const input = { phone_number: '+998901234567', password: 'secret123' };
    expect(pipe.transform(input)).toEqual(input);
  });

  it('throws BadRequestException for invalid input', () => {
    expect(() => pipe.transform({ phone_number: '', password: '123' })).toThrow(BadRequestException);
  });

  it('strips unknown fields it is not told about', () => {
    const result = pipe.transform({
      phone_number: '+998901234567',
      password: 'secret123',
    }) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(['password', 'phone_number']);
  });

  it('requires a valid proof photo when completing delivery', () => {
    const deliveryPipe = new ZodValidationPipe(deliverOrderSchema);

    expect(() => deliveryPipe.transform({ comment: 'Delivered' })).toThrow(BadRequestException);
    expect(() => deliveryPipe.transform({ photo_url: null })).toThrow(BadRequestException);
    expect(
      deliveryPipe.transform({ photo_url: 'https://cdn.test/delivery.jpg', comment: null }),
    ).toEqual({ photo_url: 'https://cdn.test/delivery.jpg', comment: null });
  });
});
