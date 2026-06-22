export interface Release {
  id: number
  name: string
  description: string | null
  version: string
  url: string
  smods_version: string | null
  lovely_version: string | null
  branchId: number
  branchName: string | null
}

export interface Branch {
  id: number
  name: string
}

export const EMPTY_FORM = {
  id: 0,
  name: '',
  version: '',
  description: '',
  url: '',
  smods_version: 'latest',
  lovely_version: 'latest',
  branchId: 1,
}

export type ReleaseForm = typeof EMPTY_FORM
