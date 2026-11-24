// Labels in English and Turkish. A screen uses one language only. Messages and
// comments (later tickets) are never translated, so they do not live here.
const en = {
  privateTitle: 'Ezeli is private',
  privateBody: 'This place is only for our friends. Ask an owner for your personal link.',
  privateMemoryBody: 'Open your personal link first. After that, this address will work.',
  badLinkTitle: 'This link does not work',
  badLinkBody: 'It has been replaced or it is not complete. Ask an owner for a new personal link.',
  failedTitle: 'Could not load',
  failedBody: 'Something went wrong. Check your connection and try again.',
  retry: 'Try again',
  loading: 'Loading',
  menu: 'Menu',
  places: 'Pages',
  memories: 'Memories',
  close: 'Close',
  signedInAs: 'Signed in as',
  owner: 'Owner',
  signOut: 'Sign out on this device',
  language: 'Language',
  saveFailed: 'Could not save. Try again.',
  emptyTitle: 'No memories yet',
  emptyBody: 'They will show up here once the owners load the chats.',
  sentBy: (names: string) => `Sent by ${names}`,
  photoBy: (name: string) => `Photo sent by ${name}`,
  photoGone: 'Photo could not load',
  photoCount: (n: string) => (n === '1' ? '1 photo' : `${n} photos`),
  commentCount: (n: string) => (n === '1' ? '1 comment' : `${n} comments`),
  jumpTo: 'Jump to a year or month',
  allMemories: 'All memories',
  conversation: 'Conversation',
  earlierMemory: 'Earlier memory',
  laterMemory: 'Later memory',
  memoryMissingTitle: 'This memory is not here',
  memoryMissingBody: 'The address may be wrong, or the memory is not there any more.',
  photo: 'Photo',
  photos: 'Photos',
  previousPhoto: 'Previous photo',
  nextPhoto: 'Next photo',
  openPhoto: (n: string) => `Open photo ${n}`,
  earlierMessages: (n: string) => (n === '1' ? 'Show 1 earlier message' : `Show ${n} earlier messages`),
  laterMessages: (n: string) => (n === '1' ? 'Show 1 later message' : `Show ${n} later messages`),
  video: 'Video',
  voice: 'Voice message',
  document: 'Document',
  gif: 'GIF',
  comments: 'Comments',
  commentsApart: 'Written here in Ezeli, later. Not part of the old chat.',
  writeComment: 'Add your note',
  addComment: 'Add comment',
  deleteComment: 'Delete',
  deleteAsk: 'Delete this comment?',
  deleteYes: 'Yes, delete',
  deleteNo: 'Keep it',
  deleteFailed: 'Could not delete. Try again.',
  mediaNotInExport: 'Media (not in the export)',
  search: 'Search',
  searchLabel: 'Search the memories',
  searchHint: 'Type a word from the messages or comments, or a name. Words of one or two letters, and signs, are searched when you press Enter.',
  searchCut: 'Only the first 8 words were searched.',
  searching: 'Searching',
  nothingFound: 'Nothing found',
  nothingFoundBody: 'Try another word, or fewer words.',
  people: 'People',
  noPeople: 'Nobody here yet',
  noPhotos: 'No photos yet',
  importPhotos: 'Import photos',
  choosePhotos: 'Choose photos',
  takenAt: 'Date and time taken',
  photoPlace: 'Place',
  photoCaption: 'Comment',
  cancelPhoto: 'Cancel',
  savePhoto: 'Save photo',
  savingPhoto: 'Saving…',
  photoSaved: 'Photo saved.',
  photoFormat: 'This photo could not be read. Try a JPG, PNG or WebP file.',
  photosSent: (n: string) => (n === '1' ? '1 photo sent' : `${n} photos sent`),
  firstMemory: 'First memory',
  latestMemory: 'Latest memory',
  personMissingTitle: 'This person is not here',
  personMissingBody: 'The address may be wrong, or they are not in the group.',
}

export type Labels = typeof en

const tr: Labels = {
  privateTitle: 'Ezeli özel',
  privateBody: 'Burası sadece arkadaşlarımız için. Kişisel bağlantın için sahiplerden birine yaz.',
  privateMemoryBody: 'Önce kişisel bağlantını aç. Ondan sonra bu adres çalışacak.',
  badLinkTitle: 'Bu bağlantı çalışmıyor',
  badLinkBody: 'Yenilenmiş ya da eksik olabilir. Sahiplerden yeni bir kişisel bağlantı iste.',
  failedTitle: 'Yüklenemedi',
  failedBody: 'Bir şeyler ters gitti. Bağlantını kontrol edip tekrar dene.',
  retry: 'Tekrar dene',
  loading: 'Yükleniyor',
  menu: 'Menü',
  places: 'Sayfalar',
  memories: 'Anılar',
  close: 'Kapat',
  signedInAs: 'Giriş yapan',
  owner: 'Sahip',
  signOut: 'Bu cihazdan çık',
  language: 'Dil',
  saveFailed: 'Kaydedilemedi. Tekrar dene.',
  emptyTitle: 'Henüz anı yok',
  emptyBody: 'Sahipler sohbetleri yükleyince burada görünecek.',
  sentBy: (names: string) => `${names} gönderdi`,
  photoBy: (name: string) => `${name} gönderdi`,
  photoGone: 'Fotoğraf yüklenemedi',
  photoCount: (n: string) => `${n} fotoğraf`,
  commentCount: (n: string) => `${n} yorum`,
  jumpTo: 'Bir yıla ya da aya git',
  allMemories: 'Tüm anılar',
  conversation: 'Konuşma',
  earlierMemory: 'Önceki anı',
  laterMemory: 'Sonraki anı',
  memoryMissingTitle: 'Bu anı burada yok',
  memoryMissingBody: 'Adres yanlış olabilir ya da anı artık yerinde değil.',
  photo: 'Fotoğraf',
  photos: 'Fotoğraflar',
  previousPhoto: 'Önceki fotoğraf',
  nextPhoto: 'Sonraki fotoğraf',
  openPhoto: (n: string) => `${n}. fotoğrafı aç`,
  earlierMessages: (n: string) => `${n} önceki mesajı göster`,
  laterMessages: (n: string) => `${n} sonraki mesajı göster`,
  video: 'Video',
  voice: 'Sesli mesaj',
  document: 'Belge',
  gif: 'GIF',
  comments: 'Yorumlar',
  commentsApart: "Ezeli'de sonradan yazıldı. Eski sohbetin parçası değil.",
  writeComment: 'Notunu ekle',
  addComment: 'Yorum ekle',
  deleteComment: 'Sil',
  deleteAsk: 'Bu yorum silinsin mi?',
  deleteYes: 'Evet, sil',
  deleteNo: 'Vazgeç',
  deleteFailed: 'Silinemedi. Tekrar dene.',
  mediaNotInExport: 'Medya (dışa aktarımda yok)',
  search: 'Ara',
  searchLabel: 'Anılarda ara',
  searchHint: "Mesajlardan ya da yorumlardan bir kelime, ya da bir isim yaz. Bir ya da iki harfli kelimeler ve işaretler Enter'a basınca aranır.",
  searchCut: 'Yalnızca ilk 8 kelime arandı.',
  searching: 'Aranıyor',
  nothingFound: 'Hiçbir şey bulunamadı',
  nothingFoundBody: 'Başka bir kelime dene, ya da daha az kelime.',
  people: 'Kişiler',
  noPeople: 'Henüz kimse yok',
  noPhotos: 'Henüz fotoğraf yok',
  importPhotos: 'Fotoğraf aktar',
  choosePhotos: 'Fotoğraf seç',
  takenAt: 'Çekildiği tarih ve saat',
  photoPlace: 'Yer',
  photoCaption: 'Yorum',
  cancelPhoto: 'Vazgeç',
  savePhoto: 'Fotoğrafı kaydet',
  savingPhoto: 'Kaydediliyor…',
  photoSaved: 'Fotoğraf kaydedildi.',
  photoFormat: 'Bu fotoğraf okunamadı. JPG, PNG veya WebP dosyası dene.',
  photosSent: (n: string) => `${n} fotoğraf gönderdi`,
  firstMemory: 'İlk anı',
  latestMemory: 'Son anı',
  personMissingTitle: 'Bu kişi burada yok',
  personMissingBody: 'Adres yanlış olabilir ya da bu kişi grupta değil.',
}

export type Language = 'tr' | 'en'
export const labels: Record<Language, Labels> = { en, tr }

// Turkish when the browser is set to Turkish, English otherwise.
export function browserLanguage(): Language {
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

// The language of the screen, and its labels. Both are live bindings: setLanguage changes them and
// tells the subscribers, App re-renders, and everything below it reads the new `t` and `language`.
// A screen just imports `t` and `language`; a new label is a key in `en` and in `tr`.
export let language: Language = browserLanguage()
export let t: Labels = labels[language]

const listeners = new Set<() => void>()
export function setLanguage(next: Language) {
  if (next === language) return
  language = next
  t = labels[next]
  listeners.forEach((listener) => listener())
}
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
export const getLanguage = () => language

// Every date and every list of names the app writes goes through here, so the language switch
// (issue 9) has one place to reach. `zone` is the time zone of the chat the date comes from: a
// memory is on the day it was sent there, wherever the reader is.
export function formatDate(lang: Language, moment: string | number | Date, zone: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone }
  return new Intl.DateTimeFormat(lang, options).format(new Date(moment))
}

// A date and time in the app's language, using the supplied zone or the reader's device zone.
export function formatDateTime(lang: Language, moment: string | number | Date, zone?: string): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(moment))
}

// "Karpuz, Limon and Fıstık" / "Karpuz, Limon ve Fıstık", in parts: the names are the chats' own
// words (marked Turkish by the screen), the commas and the "and" are the labels'.
export function formatNameParts(lang: Language, names: string[]): { text: string; name: boolean }[] {
  return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).formatToParts(names).map((part) => ({ text: part.value, name: part.type === 'element' }))
}

// "July 2023" / "Temmuz 2023" for a month key such as 2023-07; the short form is "Jul" / "Tem".
export function formatMonth(lang: Language, month: string, short = false): string {
  const options: Intl.DateTimeFormatOptions = short ? { month: 'short' } : { month: 'long', year: 'numeric' }
  return new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`))
}
