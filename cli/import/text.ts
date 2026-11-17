// Cleaning the words of a WhatsApp message before it is kept: mentions become display names or
// go, and phone numbers are removed. No phone number is ever stored or printed.
import type { People } from './people.ts'

// A phone number is a run of digits, spaces, dashes, dots, brackets and line breaks (with a plus
// or a bracket in front) of 10 to 13 digits. The limits are on purpose, privacy first:
//  - 9 digits or fewer are not numbers: dates (14.07.2023), times, years and counts stay;
//  - 14 digits or more, or digits stuck to letters (order numbers, IBANs), stay;
//  - an amount of money (a currency sign or word next to it) stays;
//  - a row of years (2019 2020 2021) and a date written out with its year stay;
//  - but an order number of 10 to 13 digits written plain is removed as a number.
const run = /(?<![\w+])(?:\+\s?)?\(?\d[\d ()\-.\n]{8,26}\d(?![\d:\w])/g
const currencyBefore = /(?:[$€£₺]|\b(?:TL|TRY|USD|EUR|GBP)\b)\s*$/i
const currencyAfter = /^\s*(?:[$€£₺]|\b(?:TL|TRY|USD|EUR|GBP|lira|dolar|euro)\b)/i
const writtenDate = /\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-]\d{4}\b|\b\d{4}-\d\d-\d\d\b/
const years = /^(?:(?:19|20)\d{2}[ \-.]?)+$/

export function removePhoneNumbers(text: string): string {
  const result = text.replace(run, (match, offset: number) => {
    const digits = match.replace(/\D/g, '').length
    // A number split across a line break is one number. Two lines that both end and start with
    // digits are not: when the whole is too long, each line is looked at alone.
    if (digits > 13 && match.includes('\n')) return match.split('\n').map(removePhoneNumbers).join('\n')
    if (digits < 10 || digits > 13) return match
    if (writtenDate.test(match) || years.test(match.trim())) return match
    if (currencyBefore.test(text.slice(Math.max(0, offset - 6), offset))) return match
    if (currencyAfter.test(text.slice(offset + match.length, offset + match.length + 8))) return match
    return ''
  })
  return result === text ? text : tidy(result)
}

// A mention is "@" and the number on Android, "@" and the name between invisible marks on an
// iPhone. A person of the people file shows as "@display name"; a left-out person, a number or
// name that is not in the file is removed, name and all.
// `shown` is what is stored. `plain` is the text without any mention: the lasting key is made
// from it, so the same message from an iPhone (a name) and from an Android phone (a number, or
// nothing the people file knows) is one message.
export function cleanText(text: string, people: People): { shown: string; plain: string } {
  const clean = (show: boolean) => {
    const mentioned = text
      .replace(/@\u2068([^\u2069\n]*)\u2069/g, (_, inner: string) => mention(inner, people, show))
      .replace(/@(\+?\d{8,15})(?!\d)/g, (_, digits: string) => mention(digits, people, show))
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    const cleaned = removePhoneNumbers(mentioned)
    return cleaned === text ? text : tidy(cleaned)
  }
  return { shown: clean(true), plain: clean(false) }
}

function mention(who: string, people: People, show: boolean): string {
  const person = people.find('whatsapp', who.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim())
  return show && person && !person.leftOut ? `@${person.name}` : ''
}

// Removing something leaves a double space or a space before a comma.
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim())
    .join('\n')
    .trim()
}
