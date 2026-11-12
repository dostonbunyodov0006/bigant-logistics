import { photoUrlSchema } from '@bigant/shared';

describe('photo addresses from the phone (06.11.2026)', () => {
  it('takes http(s) only — javascript: and data: would run in the console when clicked', () => {
    expect(photoUrlSchema.safeParse('https://logistics.example.com/media/delivery-proofs/a.jpg').success).toBe(true);
    expect(photoUrlSchema.safeParse('http://localhost:3000/media/a.jpg').success).toBe(true);
    expect(photoUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(photoUrlSchema.safeParse('JavaScript:fetch(1)//x').success).toBe(false);
    expect(photoUrlSchema.safeParse('data:text/html,<script>1</script>').success).toBe(false);
  });
});
