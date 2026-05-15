/** Microsoft Graph helpers for OneDrive read (shared by Edge Functions). */

export function encodeGraphDrivePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

export async function getGraphAppToken(): Promise<string> {
  const tenant = Deno.env.get('GRAPH_TENANT_ID')
  const clientId = Deno.env.get('GRAPH_CLIENT_ID')
  const secret = Deno.env.get('GRAPH_CLIENT_SECRET')
  if (!tenant || !clientId || !secret) {
    throw new Error('Missing GRAPH_TENANT_ID, GRAPH_CLIENT_ID, or GRAPH_CLIENT_SECRET')
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Graph token failed ${res.status}: ${t.slice(0, 500)}`)
  }

  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('No access_token from Graph')
  return json.access_token
}

function driveBaseUrl(upn: string, folderPath: string): string {
  const userSeg = encodeURIComponent(upn.trim())
  const folderEnc = encodeGraphDrivePath(folderPath.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
  return `https://graph.microsoft.com/v1.0/users/${userSeg}/drive/root:/${folderEnc}`
}

export type DriveItem = {
  name: string
  id: string
  size?: number
  lastModifiedDateTime?: string
  file?: { mimeType?: string }
}

export async function listOneDriveFolderChildren(
  folderPath: string,
): Promise<DriveItem[]> {
  const upn = Deno.env.get('GRAPH_ONEDRIVE_USER_UPN')
  if (!upn) throw new Error('Missing GRAPH_ONEDRIVE_USER_UPN')

  const token = await getGraphAppToken()
  const url = `${driveBaseUrl(upn, folderPath)}:/children?$select=name,id,size,lastModifiedDateTime,file`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Graph list folder failed ${res.status}: ${t.slice(0, 800)}`)
  }

  const json = (await res.json()) as { value?: DriveItem[] }
  return json.value ?? []
}

export async function downloadOneDriveFile(
  folderPath: string,
  fileName: string,
): Promise<ArrayBuffer> {
  const upn = Deno.env.get('GRAPH_ONEDRIVE_USER_UPN')
  if (!upn) throw new Error('Missing GRAPH_ONEDRIVE_USER_UPN')

  const token = await getGraphAppToken()
  const rel = [folderPath.trim().replace(/^\/+/, '').replace(/\/+$/, ''), fileName]
    .filter(Boolean)
    .join('/')
  const pathEnc = encodeGraphDrivePath(rel)
  const userSeg = encodeURIComponent(upn.trim())
  const url = `https://graph.microsoft.com/v1.0/users/${userSeg}/drive/root:/${pathEnc}:/content`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Graph download ${fileName} failed ${res.status}: ${t.slice(0, 800)}`)
  }

  return await res.arrayBuffer()
}
