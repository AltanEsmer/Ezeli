// Cleaning the words of a message before it is kept: mentions become display names, and phone
// numbers are removed. No phone number is ever stored or printed.
import { isPhoneNumber, type People } from './people.ts'

// Numbers as people type them. Each form is strict, so dates (14.07.2023), times, prices
// (1.250,50), years and counts do not match:
//   +90 500 000 00 01, +1 (212) 555-0101 .... a plus, then 8 to 15 digits with separators
//   0532 000 00 06, 532 000 00 06 ........... Turkish mobile, with or without the 0
//   (212) 555-0101, 212-555-0102 ............. three, three, four
//   905000000001 ............................. 11 to 15 digits in a row
const numbers = [
  /\+\d(?:[ .()-]?\d){7,14}/g,
  /(?<![\d.,+-])0?[ ]?5\d{2}[ .-]?\d{3}[ .-]?\d{2}[ .-]?\d{2}(?!\d)/g,
  /(?<![\d.,+-])\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d])/g,
  /(?<![\d.,+-])\d{11,15}(?![\d])/g,
]

export function removePhoneNumbers(text: string): string {
  let result = text
  for (const pattern of numbers) result = result.replace(pattern, '')
  return result === text ? text : tidy(result)
}

// A mention is "@" and the number on Android, "@" and the name between invisible marks on an
// iPhone. A known person becomes "@display name"; a number nobody knows is removed.
export function cleanText(text: string, people: People): string {
  const mentioned = text
    .replace(/@\u2068([^\u2069\n]*)\u2069/g, (_, inner: string) => mention(inner, people))
    .replace(/@(\+?\d{8,15})(?!\d)/g, (_, digits: string) => mention(digits, people))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  const cleaned = removePhoneNumbers(mentioned)
  return cleaned === text ? text : tidy(cleaned)
}

function mention(who: string, people: People): string {
  const name = who.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim()
  const person = people.find('whatsapp', name)
  if (person) return `@${person.name}`
  if (isPhoneNumber(name)) return ''
  return `@${name}`
}

// Removing a number leaves a double space or a space before a comma.
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim())
    .join('\n')
    .trim()
}
