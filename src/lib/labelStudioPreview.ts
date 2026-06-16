import { renderLabelPreviewDataUrl } from './dymoWebService'
import { buildLabelXmlCandidatesFromStudioForPrint } from './labelStudioXml'
import type { ThermalImageProcessOptions } from './labelStudioThermalImage'
import type { LabelStudioItem, LabelStudioTemplate } from '../types/labelStudio'

export type StudioLabelPreviewOptions = {
  printerName?: string
  thermalImage?: ThermalImageProcessOptions
}

/** PNG data URL from DYMO RenderLabel — same XML candidates as print (true WYSIWYG when DYMO is running). */
export async function buildStudioLabelPreviewDataUrl(
  template: LabelStudioTemplate,
  item: LabelStudioItem,
  options?: StudioLabelPreviewOptions
): Promise<string | null> {
  const candidates = await buildLabelXmlCandidatesFromStudioForPrint(template, item, {
    thermalImage: options?.thermalImage,
  })
  return renderLabelPreviewDataUrl(candidates, options?.printerName)
}
