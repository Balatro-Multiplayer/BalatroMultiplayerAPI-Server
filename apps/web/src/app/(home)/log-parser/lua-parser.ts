// @ts-nocheck
'use client'

type LuaValue = string | number | boolean | null | LuaTable | LuaValue[]
type LuaTable = { [key: string]: LuaValue }

export class LuaParser {
  private pos = 0
  private input = ''
  private currentChar: string | null | undefined = null

  constructor(input: string) {
    this.input = input.trim()
    this.currentChar = this.input[0] ?? null
  }

  private advance(): void {
    this.pos++
    this.currentChar =
      this.pos < this.input.length ? this.input[this.pos] : null
  }

  private skipWhitespace(): void {
    while (
      this.currentChar?.match(/\s/) !== null &&
      this.currentChar !== null
    ) {
      this.advance()
    }
  }

  private parseString(): string {
    let result = ''
    const quote = this.currentChar
    this.advance() // Skip opening quote

    while (this.currentChar !== null && this.currentChar !== quote) {
      if (this.currentChar === '\\') {
        this.advance()
        switch (this.currentChar) {
          case 'n':
            result += '\n'
            break
          case 't':
            result += '\t'
            break
          case 'r':
            result += '\r'
            break
          case 'b':
            result += '\b'
            break
          case 'f':
            result += '\f'
            break
          case '"':
          case "'":
          case '\\':
            result += this.currentChar
            break
          default:
            throw new Error(`Invalid escape sequence: \\${this.currentChar}`)
        }
      } else {
        result += this.currentChar
      }
      this.advance()
    }

    if (this.currentChar === null) {
      throw new Error('Unterminated string')
    }
    this.advance() // Skip closing quote
    return result
  }

  private parseNumber(): number {
    let result = ''

    if (this.currentChar === '-') {
      result += this.currentChar
      this.advance()
    }

    while (
      this.currentChar?.match(/[\d.]/) !== null &&
      this.currentChar !== null
    ) {
      result += this.currentChar
      this.advance()
    }

    const num = Number.parseFloat(result)
    if (Number.isNaN(num)) {
      throw new Error(`Invalid number: ${result}`)
    }
    return num
  }

  private parseIdentifier(): string {
    let result = ''

    while (
      this.currentChar?.match(/[a-zA-Z0-9_]/) !== null &&
      this.currentChar !== null
    ) {
      result += this.currentChar
      this.advance()
    }

    return result
  }

  private parseValue(): LuaValue {
    this.skipWhitespace()

    if (this.currentChar === null) {
      throw new Error('Unexpected end of input')
    }

    switch (this.currentChar) {
      case '{':
        return this.parseTable()
      case '"':
      case "'":
        return this.parseString()
      case '-':
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        return this.parseNumber()
      default: {
        const identifier = this.parseIdentifier()
        switch (identifier.toLowerCase()) {
          case 'true':
            return true
          case 'false':
            return false
          case 'nil':
            return null
          default:
            throw new Error(`Unexpected identifier: ${identifier}`)
        }
      }
    }
  }

  private parseTable(): LuaTable | LuaValue[] {
    this.advance() // Skip '{'
    this.skipWhitespace()

    const result: LuaTable = {}
    const array: LuaValue[] = []
    let isArray = true
    let index = 0

    while (this.currentChar !== null && this.currentChar !== '}') {
      this.skipWhitespace()

      if (this.currentChar === '[') {
        isArray = false
        this.advance() // Skip '['
        const key = this.parseValue()
        if (typeof key !== 'string' && typeof key !== 'number') {
          throw new Error('Table key must be string or number')
        }
        this.skipWhitespace()

        if (this.currentChar !== ']') {
          throw new Error("Expected ']'")
        }
        this.advance() // Skip ']'
        this.skipWhitespace()

        if (this.currentChar !== '=') {
          throw new Error("Expected '='")
        }
        this.advance() // Skip '='

        const value = this.parseValue()
        result[String(key)] = value
      } else {
        const value = this.parseValue()
        if (isArray) {
          array.push(value)
          index++
        } else {
          result[String(index)] = value
          index++
        }
      }

      this.skipWhitespace()
      if (this.currentChar === ',') {
        this.advance()
      } else if (this.currentChar !== '}') {
        throw new Error("Expected ',' or '}'")
      }
    }

    if (this.currentChar === null) {
      throw new Error('Unterminated table')
    }
    this.advance() // Skip '}'

    return isArray ? array : result
  }

  public parse(): LuaValue {
    const result = this.parseValue()
    this.skipWhitespace()

    if (this.currentChar !== null) {
      throw new Error('Unexpected characters after end of input')
    }

    return result
  }
}

export async function convertLuaToJson(luaString: string): Promise<string> {
  try {
    const parser = new LuaParser(luaString)
    const parsed = parser.parse()
    return JSON.stringify(parsed, null, 2)
  } catch (error) {
    console.error('Error converting Lua to JSON:', error)
    throw error
  }
}
