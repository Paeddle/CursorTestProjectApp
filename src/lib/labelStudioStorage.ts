import type { LabelStudioTemplate } from '../types/labelStudio'
import { defaultShippingTemplate, normalizeStudioTemplate } from '../types/labelStudio'

const STORAGE_KEY = 'label-studio-templates-v1'

function readAll(): LabelStudioTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (t): t is LabelStudioTemplate =>
          t != null &&
          typeof t === 'object' &&
          typeof (t as LabelStudioTemplate).id === 'string' &&
          Array.isArray((t as LabelStudioTemplate).elements)
      )
      .map((t) => normalizeStudioTemplate(t))
  } catch {
    return []
  }
}

function writeAll(templates: LabelStudioTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function loadLabelStudioTemplates(): LabelStudioTemplate[] {
  const saved = readAll()
  if (saved.length === 0) {
    return [defaultShippingTemplate()]
  }
  return saved
}

export function saveLabelStudioTemplate(template: LabelStudioTemplate): void {
  const all = readAll()
  const idx = all.findIndex((t) => t.id === template.id)
  const next = { ...template, updatedAt: new Date().toISOString() }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  writeAll(all)
}

export function deleteLabelStudioTemplate(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id))
}

export function duplicateLabelStudioTemplate(template: LabelStudioTemplate): LabelStudioTemplate {
  return {
    ...template,
    id: `tpl-${Date.now().toString(36)}`,
    name: `${template.name} (copy)`,
    updatedAt: new Date().toISOString(),
    elements: template.elements.map((el) => ({
      ...el,
      id: `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    })),
  }
}
