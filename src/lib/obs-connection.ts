export class OBSController {
  private ws: WebSocket | null = null
  private connectPromise: Promise<void> | null = null

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return

    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:4455')

      this.ws.onopen = () => {
        console.log('connected to obs')
        this.ws?.send(
          JSON.stringify({
            op: 1,
            d: { rpcVersion: 1 },
          })
        )
      }

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.op === 2) {
          // Identified
          resolve()
        }
      }

      this.ws.onerror = (error) => {
        console.error('ws error:', error)
        reject(error)
      }

      this.ws.onclose = () => {
        console.log('disconnected from obs')
        this.ws = null
        this.connectPromise = null
      }
    })

    return this.connectPromise
  }

  async updateText(inputName: string, text: string): Promise<void> {
    await this.connect()

    this.ws?.send(
      JSON.stringify({
        op: 6,
        d: {
          requestType: 'SetInputSettings',
          requestId: 'update',
          requestData: {
            inputName,
            inputSettings: { text },
          },
        },
      })
    )
  }
  async getInputs(): Promise<{ inputName: string; inputKind: string }[]> {
    await this.connect()

    return new Promise((resolve, _reject) => {
      const requestId = `get-inputs-${Date.now()}`

      const handleMessage = (event: MessageEvent) => {
        const data = JSON.parse(event.data)
        if (data.op === 7 && data.d.requestId === requestId) {
          this.ws?.removeEventListener('message', handleMessage)
          resolve(data.d.responseData.inputs)
        }
      }

      this.ws?.addEventListener('message', handleMessage)

      this.ws?.send(
        JSON.stringify({
          op: 6,
          d: {
            requestType: 'GetInputList',
            requestId,
          },
        })
      )
    })
  }
}
