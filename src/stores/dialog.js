// 应用内弹窗：confirm / prompt / alert（替代原生浏览器对话框）
import { reactive } from 'vue'

const state = reactive({
  open: false,
  mode: 'alert', // alert | confirm | prompt
  title: '',
  message: '',
  placeholder: '',
  inputValue: '',
  danger: false,
  confirmText: '',
  cancelText: '',
  resolve: null,
})

function finish(result) {
  const resolve = state.resolve
  state.open = false
  state.resolve = null
  state.inputValue = ''
  if (resolve) resolve(result)
}

function openDialog(mode, options = {}) {
  return new Promise((resolve) => {
    // 若已有弹窗，先以「当前旧弹窗」的取消语义关闭，避免用新 mode 错判返回值
    if (state.open && state.resolve) {
      const prevMode = state.mode
      state.resolve(prevMode === 'prompt' ? null : false)
    }

    state.mode = mode
    state.title = options.title || ''
    state.message = options.message || ''
    state.placeholder = options.placeholder || ''
    state.inputValue = options.defaultValue != null ? String(options.defaultValue) : ''
    state.danger = !!options.danger
    state.confirmText = options.confirmText || ''
    state.cancelText = options.cancelText || ''
    state.resolve = resolve
    state.open = true
  })
}

export function useDialog() {
  return {
    state,
    alert(options = {}) {
      if (typeof options === 'string') options = { message: options }
      return openDialog('alert', options).then(() => true)
    },
    confirm(options = {}) {
      if (typeof options === 'string') options = { message: options }
      return openDialog('confirm', options)
    },
    prompt(options = {}) {
      if (typeof options === 'string') options = { message: options }
      return openDialog('prompt', options)
    },
    cancel() {
      if (!state.open) return
      finish(state.mode === 'prompt' ? null : false)
    },
    submit() {
      if (!state.open) return
      if (state.mode === 'prompt') finish(state.inputValue)
      else finish(true)
    },
  }
}

export default useDialog
