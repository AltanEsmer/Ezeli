import '@fontsource/kalam/400.css'
import '@fontsource/kalam/700.css'
import '@fontsource/karla/400.css'
import '@fontsource/karla/700.css'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { language } from './i18n.ts'
import './styles.css'

document.documentElement.lang = language
createRoot(document.getElementById('root')!).render(<App />)
