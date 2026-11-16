const configuredApiUrl = import.meta.env.VITE_API_URL;
const placeholderApiUrl = /^(https?:\/\/)?(tu-backend|example\.com|localhost:3000)$/i;

export const API_URL = (
  configuredApiUrl && !placeholderApiUrl.test(configuredApiUrl.trim())
    ? configuredApiUrl.trim()
    : 'http://localhost:3000'
).replace(/\/$/, '');