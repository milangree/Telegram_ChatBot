// src/stores/api.js
import axios from 'axios'

const api = axios.create({ timeout: 30000, headers: { 'Content-Type': 'application/json' }, withCredentials: true })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r.data,
  error => {
    const status  = error.response?.status
    const message = error.response?.data?.error || error.message || '请求失败'
    if (status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('username')
      localStorage.removeItem('isAdmin')
    }
    return Promise.reject(new Error(message))
  }
)

export default api
