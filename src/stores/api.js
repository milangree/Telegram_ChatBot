// src/stores/api.js
import axios from 'axios'

const api = axios.create({
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true  // 允许携带 Cookie
})

// 请求拦截器 - 添加 token
api.interceptors.request.use(config => {
  // 从 localStorage 获取 token
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  
  // 调试日志
  console.log(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, {
    hasToken: !!token,
    url: config.url
  })
  
  return config
}, error => {
  console.error('[API Request Error]', error)
  return Promise.reject(error)
})

// 响应拦截器
api.interceptors.response.use(
  response => {
    console.log(`[API Response] ${response.config.url}`, response.status)
    return response.data
  },
  error => {
    const status = error.response?.status
    const message = error.response?.data?.error || error.message || '请求失败'
    const url = error.config?.url
    
    console.error(`[API Error] ${url}`, status, message)
    
    // 401 未授权，清除本地数据
    if (status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('username')
      localStorage.removeItem('isAdmin')
      // 不在拦截器中跳转，让组件处理
    }
    
    return Promise.reject(new Error(message))
  }
)

export default api
