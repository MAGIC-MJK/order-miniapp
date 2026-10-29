import { useCallback, useState } from 'react'
import Taro from '@tarojs/taro'
import { cartItems as demoCart } from '@/data/mock'
import { runtimeConfig } from '@/config/runtime'
import type { CartItem, ImportSource, Product } from '@/types'
import { mergeCartLines, normaliseCartItems } from '@/utils/cartLines'

const CART_KEY = 'yg-cart-v1'

function cloneDemoCart() {
  return normaliseCartItems(demoCart.map((item) => ({ ...item })))
}

export function loadCart(): CartItem[] {
  const saved = Taro.getStorageSync<CartItem[]>(CART_KEY)
  if (Array.isArray(saved)) return persistCart(normaliseCartItems(saved))
  return runtimeConfig.demoMode ? cloneDemoCart() : []
}

export function persistCart(items: CartItem[]) {
  const normalised = normaliseCartItems(items)
  Taro.setStorageSync(CART_KEY, normalised)
  return normalised
}

export function clearPersistedCart() {
  persistCart([])
}

export function mergeImportedLines(current: CartItem[], incoming: CartItem[]) {
  return mergeCartLines(current, incoming)
}

export function useCart() {
  const [items, setItemsState] = useState<CartItem[]>(() => loadCart())

  const setItems = useCallback((next: CartItem[] | ((current: CartItem[]) => CartItem[])) => {
    setItemsState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      return persistCart(value)
    })
  }, [])

  const addProduct = useCallback((product: Product, color: string, size: string, quantity = 1, source: ImportSource = 'manual') => {
    setItems((current) => mergeImportedLines(current, [{
      id: '',
      productId: product.id,
      productCode: product.code,
      name: product.name,
      color,
      size,
      specs: size,
      quantity,
      unitPrice: product.price,
      source
    }]))
  }, [setItems])

  const updateQuantity = useCallback((id: string, quantity: number) => {
    setItems((current) => current
      .map((item) => item.id === id ? { ...item, quantity: Math.max(0, quantity) } : item)
      .filter((item) => item.quantity > 0))
  }, [setItems])

  const mergeImport = useCallback((incoming: CartItem[]) => {
    setItems((current) => mergeImportedLines(current, incoming))
  }, [setItems])

  const clear = useCallback(() => setItems([]), [setItems])
  const count = items.reduce((sum, item) => sum + item.quantity, 0)
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)

  return { items, setItems, addProduct, updateQuantity, mergeImport, clear, count, total }
}
