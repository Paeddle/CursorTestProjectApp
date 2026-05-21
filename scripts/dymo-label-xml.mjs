export const LABEL_TEXT_OBJECT_NAME = 'TEXT'
export const LABEL_JOB_OBJECT_NAME = 'JOB'
export const LABEL_LOC_OBJECT_NAME = 'LOC'

export const DYMO_PAPER_TEMPLATES = [
  {
    id: 'LargeShipping',
    paperName: '30256 Shipping',
    drawWidth: 3331,
    drawHeight: 5715,
    boundsX: 336,
    boundsY: 58,
    boundsWidth: 5338,
    boundsHeight: 3192,
  },
  {
    id: 'Shipping',
    paperName: '30323 Shipping',
    drawWidth: 5811,
    drawHeight: 1581,
    boundsX: 200,
    boundsY: 50,
    boundsWidth: 5411,
    boundsHeight: 1481,
  },
  {
    id: 'Address',
    paperName: '30252 Address',
    drawWidth: 1581,
    drawHeight: 5040,
    boundsX: 332,
    boundsY: 150,
    boundsWidth: 4455,
    boundsHeight: 1260,
  },
]

const LABEL_FONT_STEPS = [
  { size: 32, charsPerLine: 22, jobWrapFactor: 0.5, maxJobLines: 5, maxLocLines: 2 },
  { size: 28, charsPerLine: 26, jobWrapFactor: 0.52, maxJobLines: 5, maxLocLines: 3 },
  { size: 24, charsPerLine: 30, jobWrapFactor: 0.55, maxJobLines: 6, maxLocLines: 3 },
  { size: 20, charsPerLine: 34, jobWrapFactor: 0.58, maxJobLines: 7, maxLocLines: 4 },
  { size: 18, charsPerLine: 38, jobWrapFactor: 0.62, maxJobLines: 8, maxLocLines: 4 },
]

export const LABEL_JOB_LOC_FONT_GAP = 10
export const LABEL_LOCATION_MIN_FONT_SIZE = 12

function locationFontSizeForJob(jobFontSize, hasJob, hasLocation) {
  if (!hasLocation) return jobFontSize
  if (!hasJob) return jobFontSize
  return Math.max(LABEL_LOCATION_MIN_FONT_SIZE, jobFontSize - LABEL_JOB_LOC_FONT_GAP)
}

function jobCharsPerLine(stepChars, jobWrapFactor) {
  return Math.max(10, Math.round(stepChars * jobWrapFactor))
}

function locationCharsPerLine(jobCharsPerLine, jobFontSize, locationFontSize) {
  return jobCharsPerLine + Math.round((jobFontSize - locationFontSize) * 0.85)
}

export function escapeXmlText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

export function wrapText(text, maxChars) {
  const t = String(text || '').trim()
  if (!t) return []
  const lines = []
  let current = ''
  const flush = () => {
    if (current) {
      lines.push(current)
      current = ''
    }
  }
  for (const word of t.split(/\s+/)) {
    let rest = word
    while (rest.length) {
      if (!current) {
        if (rest.length <= maxChars) {
          current = rest
          rest = ''
        } else {
          lines.push(rest.slice(0, maxChars))
          rest = rest.slice(maxChars)
        }
        continue
      }
      const joined = `${current} ${rest}`
      if (joined.length <= maxChars) {
        current = joined
        rest = ''
      } else {
        flush()
      }
    }
  }
  flush()
  return lines
}

function jobAndLocationText(row) {
  return {
    job: String(row.job_name || row.item_name || '').trim(),
    location: String(row.location_name || '').trim(),
  }
}

export function labelLayoutForRow(row) {
  const { job, location } = jobAndLocationText(row)
  const hasJob = Boolean(job)
  const hasLocation = Boolean(location)
  for (const step of LABEL_FONT_STEPS) {
    const jobFontSize = step.size
    const locationFontSize = locationFontSizeForJob(jobFontSize, hasJob, hasLocation)
    const jobChars = jobCharsPerLine(step.charsPerLine, step.jobWrapFactor)
    const locChars = locationCharsPerLine(jobChars, jobFontSize, locationFontSize)
    const jobLines = job ? wrapText(job, jobChars) : []
    const locationLines = location ? wrapText(location, locChars) : []
    if (jobLines.length <= step.maxJobLines && locationLines.length <= step.maxLocLines) {
      return { jobFontSize, locationFontSize, jobLines, locationLines }
    }
  }
  const fallback = LABEL_FONT_STEPS[LABEL_FONT_STEPS.length - 1]
  const jobFontSize = fallback.size
  const locationFontSize = locationFontSizeForJob(jobFontSize, hasJob, hasLocation)
  const jobChars = jobCharsPerLine(fallback.charsPerLine, fallback.jobWrapFactor)
  const locChars = locationCharsPerLine(jobChars, jobFontSize, locationFontSize)
  const jobLines = job ? wrapText(job, jobChars).slice(0, fallback.maxJobLines) : []
  const locationLines = location
    ? wrapText(location, locChars).slice(0, fallback.maxLocLines)
    : []
  if (jobLines.length === 0 && locationLines.length === 0) {
    return { jobFontSize, locationFontSize, jobLines: ['(no text)'], locationLines: [] }
  }
  return { jobFontSize, locationFontSize, jobLines, locationLines }
}

function fontAttributesXml(fontSize) {
  return (
    `<Font Family="Arial" Size="${fontSize}" Bold="True" Italic="False" Underline="False" Strikeout="False"/>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>`
  )
}

function buildStyledTextXml(lines, fontSize) {
  const attrs = fontAttributesXml(fontSize)
  const textLines = lines.length > 0 ? lines : ['']
  return textLines
    .map(
      (line) =>
        `<Element><String>${escapeXmlText(line)}</String><Attributes>${attrs}</Attributes></Element>`
    )
    .join('')
}

function buildTextObjectXml(objectName, lines, fontSize, bounds, textFitMode) {
  const styled = buildStyledTextXml(lines, fontSize)
  return (
    `<ObjectInfo>` +
    `<TextObject>` +
    `<Name>${objectName}</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>` +
    `<BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName>` +
    `<Rotation>Rotation0</Rotation>` +
    `<IsMirrored>False</IsMirrored>` +
    `<IsVariable>False</IsVariable>` +
    `<HorizontalAlignment>Center</HorizontalAlignment>` +
    `<VerticalAlignment>Middle</VerticalAlignment>` +
    `<TextFitMode>${textFitMode}</TextFitMode>` +
    `<UseFullFontHeight>True</UseFullFontHeight>` +
    `<Verticalized>False</Verticalized>` +
    `<StyledText>${styled}</StyledText>` +
    `</TextObject>` +
    `<Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}"/>` +
    `</ObjectInfo>`
  )
}

function splitBoundsForLayout(template, jobLines, locationLines) {
  const base = {
    x: template.boundsX,
    y: template.boundsY,
    width: template.boundsWidth,
    height: template.boundsHeight,
  }
  const hasJob = jobLines.length > 0 && jobLines[0] !== '(no text)'
  const hasLoc = locationLines.length > 0
  if (hasJob && hasLoc) {
    const gap = Math.max(48, Math.round(template.boundsHeight * 0.08))
    const inner = template.boundsHeight - gap
    const jobHeight = Math.round(inner * 0.62)
    const locHeight = inner - jobHeight
    return {
      job: { x: base.x, y: base.y, width: base.width, height: jobHeight },
      location: {
        x: base.x,
        y: base.y + jobHeight + gap,
        width: base.width,
        height: locHeight,
      },
    }
  }
  if (hasJob) return { job: base }
  if (hasLoc) return { location: base }
  return { job: base }
}

export function buildLabelXml(layout, template = DYMO_PAPER_TEMPLATES[0]) {
  const { jobFontSize, locationFontSize, jobLines, locationLines } = layout
  const regions = splitBoundsForLayout(template, jobLines, locationLines)
  const objects = []
  if (regions.job) {
    objects.push(
      buildTextObjectXml(LABEL_JOB_OBJECT_NAME, jobLines, jobFontSize, regions.job, 'None')
    )
  }
  if (regions.location) {
    objects.push(
      buildTextObjectXml(
        LABEL_LOC_OBJECT_NAME,
        locationLines,
        locationFontSize,
        regions.location,
        'None'
      )
    )
  }
  const t = template
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>Landscape</PaperOrientation>` +
    `<Id>${t.id}</Id>` +
    `<PaperName>${t.paperName}</PaperName>` +
    `<DrawCommands>` +
    `<RoundRectangle X="0" Y="0" Width="${t.drawWidth}" Height="${t.drawHeight}" Rx="270" Ry="270"/>` +
    `</DrawCommands>` +
    objects.join('') +
    `</DieCutLabel>`
  )
}

export function buildLabelXmlCandidates(layout) {
  return DYMO_PAPER_TEMPLATES.map((template) => buildLabelXml(layout, template))
}

export function buildLabelXmlForRow(row) {
  return buildLabelXml(labelLayoutForRow(row))
}

export function buildLabelXmlCandidatesForRow(row) {
  return buildLabelXmlCandidates(labelLayoutForRow(row))
}

export function assertDymoPrintSucceeded(result, endpoint) {
  if (result === true) return
  const s = String(result ?? '').trim()
  if (!s || s.toLowerCase() === 'true') return
  if (s.toLowerCase() === 'false') {
    throw new Error(
      `${endpoint}: DYMO rejected the label. In DYMO Connect, add the roll size (30323 / 30256 Shipping) and reload Print Station.`
    )
  }
  if (/error|exception|invalid|not found|failed/i.test(s)) {
    throw new Error(`${endpoint}: ${s.slice(0, 400)}`)
  }
}
