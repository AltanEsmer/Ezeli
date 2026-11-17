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
}

// Turkish when the browser is set to Turkish, English otherwise.
export function pickLanguage(): 'tr' | 'en' {
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export const language = pickLanguage()
export const t: Labels = language === 'tr' ? tr : en
