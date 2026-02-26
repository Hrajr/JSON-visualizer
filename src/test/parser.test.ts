import * as assert from 'assert';
import { StreamJsonParser } from '../parser/streamJsonObjects';

describe('StreamJsonParser', () => {
  function parseString(input: string): { objects: Record<string, unknown>[]; errors: string[] } {
    const parser = new StreamJsonParser();
    const objects: Record<string, unknown>[] = [];
    const errors: string[] = [];

    parser.on('object', (obj: Record<string, unknown>) => {
      objects.push(obj);
    });

    parser.on('error', (err: Error, raw: string) => {
      errors.push(`${err.message}: ${raw}`);
    });

    parser.parseString(input);
    return { objects, errors };
  }

  it('should parse a single JSON object', () => {
    const { objects, errors } = parseString('{"name":"Alice","age":30}');
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].name, 'Alice');
    assert.strictEqual(objects[0].age, 30);
  });

  it('should parse multiple concatenated JSON objects', () => {
    const input = '{"a":1}\n{"b":2}\n{"c":3}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 3);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].a, 1);
    assert.strictEqual(objects[1].b, 2);
    assert.strictEqual(objects[2].c, 3);
  });

  it('should handle pretty-printed JSON objects', () => {
    const input = `{
  "name": "Bob",
  "age": 25
}
{
  "name": "Carol",
  "age": 35
}`;
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 2);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].name, 'Bob');
    assert.strictEqual(objects[1].name, 'Carol');
  });

  it('should handle braces inside strings', () => {
    const input = '{"data":"value with { and } braces","count":1}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].data, 'value with { and } braces');
  });

  it('should handle escaped quotes inside strings', () => {
    const input = '{"quote":"He said \\"hello\\"","ok":true}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].quote, 'He said "hello"');
  });

  it('should handle nested objects', () => {
    const input = '{"outer":{"inner":{"deep":"value"}}}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.deepStrictEqual(objects[0].outer, { inner: { deep: 'value' } });
  });

  it('should handle arrays inside objects', () => {
    const input = '{"items":[1,2,{"nested":true}]}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.deepStrictEqual(objects[0].items, [1, 2, { nested: true }]);
  });

  it('should handle objects split across simulated chunks', () => {
    // Simulate what happens when a read boundary splits an object
    const parser = new StreamJsonParser();
    const objects: Record<string, unknown>[] = [];

    parser.on('object', (obj: Record<string, unknown>) => {
      objects.push(obj);
    });

    // Feed in two chunks that split an object at an awkward boundary
    const chunk1 = '{"first":"val1"}\n{"sec';
    const chunk2 = 'ond":"val2"}\n{"third":"val3"}';

    // Use the internal processChunk (via parseString hack: reset after first chunk)
    // Actually, we'll directly use processChunk by calling parseString on combined
    // but simulating chunk boundaries by feeding one chunk, then the next
    // We need to access the private method, so let's cast
    (parser as any).processChunk(chunk1);
    (parser as any).processChunk(chunk2);
    parser.emit('end', 0, 0);

    assert.strictEqual(objects.length, 3);
    assert.strictEqual(objects[0].first, 'val1');
    assert.strictEqual(objects[1].second, 'val2');
    assert.strictEqual(objects[2].third, 'val3');
  });

  it('should handle empty input', () => {
    const { objects, errors } = parseString('');
    assert.strictEqual(objects.length, 0);
    assert.strictEqual(errors.length, 0);
  });

  it('should handle whitespace-only input', () => {
    const { objects, errors } = parseString('   \n\n\t  ');
    assert.strictEqual(objects.length, 0);
    assert.strictEqual(errors.length, 0);
  });

  it('should handle objects with many properties', () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 70; i++) {
      obj[`prop${i}`] = `value${i}`;
    }
    const input = JSON.stringify(obj);
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].prop0, 'value0');
    assert.strictEqual(objects[0].prop69, 'value69');
  });

  it('should handle backslash at end of string', () => {
    const input = '{"path":"C:\\\\Users\\\\test"}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].path, 'C:\\Users\\test');
  });

  it('should recover from malformed objects and continue', () => {
    const input = '{"good":1}\n{bad json}\n{"also_good":2}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 2);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(objects[0].good, 1);
    assert.strictEqual(objects[1].also_good, 2);
  });

  it('should handle unicode in strings', () => {
    const input = '{"emoji":"Hello 🌍","jp":"日本語"}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].emoji, 'Hello 🌍');
    assert.strictEqual(objects[0].jp, '日本語');
  });

  it('should handle multiple objects without any whitespace between them', () => {
    const input = '{"a":1}{"b":2}{"c":3}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 3);
    assert.strictEqual(errors.length, 0);
  });

  it('should handle string values containing newlines', () => {
    const input = '{"text":"line1\\nline2\\nline3"}';
    const { objects, errors } = parseString(input);
    assert.strictEqual(objects.length, 1);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(objects[0].text, 'line1\nline2\nline3');
  });
});
