// Labels in English and Turkish. A screen uses one language only. Messages and
// comments (later tickets) are never translated, so they do not live here.
const en = {
  privateTitle: 'Ezeli is private',
  privateBody: 'This place is only for our friends. Ask an owner for your personal link.',
  badLinkTitle: 'This link does not work',
  badLinkBody: 'It has been replaced or it is not complete. Ask an owner for a new personal link.',
  failedTitle: 'Could not load',
  failedBody: 'Something went wrong. Check your connection and try again.',
  retry: 'Try again',
  loading: 'Loading',
  menu: 'Menu',
  close: 'Close',
  signedInAs: 'Signed in as',
  owner: 'Owner',
  signOut: 'Sign out on this device',
  emptyTitle: 'No memories yet',
  emptyBody: 'They will show up here once the owners load the chats.',
  sentBy: (names: string) => `Sent by ${names}`,
  photoBy: (name: string) => `Photo sent by ${name}`,
  mediaNotInExport: 'Media (not in the export)',
}

export type Labels = typeof en

const tr: Labels = {
  privateTitle: 'Ezeli özel',
  privateBody: 'Burası sadece arkadaşlarımız için. Kişisel bağlantın için sahiplerden birine yaz.',
  badLinkTitle: 'Bu bağlantı çalışmıyor',
  badLinkBody: 'Yenilenmiş ya da eksik olabilir. Sahiplerden yeni bir kişisel bağlantı iste.',
  failedTitle: 'Yüklenemedi',
  failedBody: 'Bir şeyler ters gitti. Bağlantını kontrol edip tekrar dene.',
  retry: 'Tekrar dene',
  loading: 'Yükleniyor',
  menu: 'Menü',
  close: 'Kapat',
  signedInAs: 'Giriş yapan',
  owner: 'Sahip',
  signOut: 'Bu cihazdan çık',
  emptyTitle: 'Henüz anı yok',
  emptyBody: 'Sahipler sohbetleri yükleyince burada görünecek.',
  sentBy: (names: string) => `${names} gönderdi`,
  photoBy: (name: string) => `${name} gönderdi`,
  mediaNotInExport: 'Medya (dışa aktarımda yok)',
}

// Turkish when the browser is set to Turkish, English otherwise.
export function pickLanguage(): 'tr' | 'en' {
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export const language = pickLanguage()
export const t: Labels = language === 'tr' ? tr : en

export type Language = 'tr' | 'en'

// Every date and every list of names the app writes goes through here, so the language switch
// (issue 9) has one place to reach. `zone` is the time zone of the chat the date comes from: a
// memory is on the day it was sent there, wherever the reader is.
export function formatDate(lang: Language, moment: string | number | Date, zone: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone }
  return new Intl.DateTimeFormat(lang, options).format(new Date(moment))
}

// "Karpuz, Limon and Fıstık" / "Karpuz, Limon ve Fıstık".
export function formatNames(lang: Language, names: string[]): string {
  return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(names)
}
