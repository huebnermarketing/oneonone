/**
 * App-wide zod error messages. zod 4 changed its default wording ("Required" became
 * "Invalid input: expected string, received undefined"; an unparsable date reads
 * "expected date, received Date"). These messages reach users via API `details[].message`
 * and react-hook-form field errors, so keep the clearer v3-style text.
 *
 * Messages passed explicitly in a schema (`.min(1, 'Title is required')`) still take precedence —
 * this map only fills in defaults. Imported for its side effect by lib/validation/common.ts (server)
 * and by every client component that builds a zod schema for react-hook-form.
 */
import { z } from 'zod'

const describe = (input: unknown) => (input === null ? 'null' : Array.isArray(input) ? 'array' : Number.isNaN(input) ? 'nan' : typeof input)

z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        if (iss.input === undefined) return 'Required'
        if (iss.expected === 'date') return 'Invalid date'
        return `Expected ${iss.expected}, received ${describe(iss.input)}`
      case 'invalid_value':
        if (iss.input === undefined) return 'Required'
        return `Invalid value. Expected ${iss.values.map((v) => `'${String(v)}'`).join(' | ')}`
      case 'too_small': {
        const n = Number(iss.minimum)
        if (iss.origin === 'string') return n === 1 ? 'Required' : `Must be at least ${n} characters`
        if (iss.origin === 'number') return `Must be ${iss.inclusive ? 'at least' : 'greater than'} ${n}`
        if (iss.origin === 'array') return `Must contain at least ${n} item${n === 1 ? '' : 's'}`
        return undefined
      }
      case 'too_big': {
        const n = Number(iss.maximum)
        if (iss.origin === 'string') return `Must be at most ${n} characters`
        if (iss.origin === 'number') return `Must be ${iss.inclusive ? 'at most' : 'less than'} ${n}`
        if (iss.origin === 'array') return `Must contain at most ${n} item${n === 1 ? '' : 's'}`
        return undefined
      }
      case 'invalid_format':
        if (iss.format === 'email') return 'Invalid email address'
        if (iss.format === 'uuid') return 'Invalid id'
        if (iss.format === 'url') return 'Invalid URL'
        if (iss.format === 'regex') return 'Invalid format'
        return undefined
      default:
        return undefined // zod's own message
    }
  },
})

export {}
