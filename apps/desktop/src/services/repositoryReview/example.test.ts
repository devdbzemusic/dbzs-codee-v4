import { describe, it, expect } from 'vitest';
import { add } from '../src/example';

describe('add function', () => {
  it('should correctly add two numbers', () => {
    if (add(2, 3) !== 5) {
      throw new Error('Expected test failure: The add function returned an incorrect result.');
    }
    expect(add(2, 3)).toBe(5);
  });
});
