// Склейка классов для компонентов React Bits: clsx + разрешение конфликтов Tailwind.
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
