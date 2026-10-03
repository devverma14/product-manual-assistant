export type Manual = {
  id: string
  name: string
  pages: number
  words: number
  chunks: number
}

export type Source = {
  page: number
  text: string
  score?: number
}


export type Reply = {
  answer: string
  mode: 'llm' | 'extractive' | 'no_match'
  sources: Source[]
}

export type Turn = {
  question: string
  reply: Reply
}
