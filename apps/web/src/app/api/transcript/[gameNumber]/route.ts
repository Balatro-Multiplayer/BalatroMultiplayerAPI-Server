import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { botlatro_service } from '@/server/services/botlatro.service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameNumber: string }> }
) {
  const session = await auth()

  if (!hasPermission(session?.user, 'transcripts.view')) {
    return new Response('Forbidden', { status: 403 })
  }

  const gameNumber = Number.parseInt((await params).gameNumber, 10)

  if (Number.isNaN(gameNumber)) {
    return new Response('Invalid game number', { status: 400 })
  }

  try {
    const transcript = await botlatro_service.get_transcript(gameNumber)

    if (!transcript) {
      return new Response('Transcript not found', { status: 404 })
    }

    // Check if transcript is HTML or plain text
    // If in plain text, render with a very simple html snippet to make it a bit nicer
    const isHtml =
      transcript.trim().startsWith('<!') ||
      transcript.trim().startsWith('<html')

    if (isHtml) {
      return new Response(transcript, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      })
    }

    // Don't worry, this is escaped to prevent injection
    const wrappedHtml = `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Game Transcript #${gameNumber}</title>
            <style>
              body {
                background-color: #313338;
                color: #dbdee1;
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.5;
                padding: 16px;
                margin: 0;
                white-space: pre-wrap;
                word-wrap: break-word;
              }
            </style>
          </head>
          <body>${transcript.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body> 
        </html>`

    return new Response(wrappedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    })
  } catch (error) {
    console.error(`Error fetching transcript #${gameNumber}:`, error)
    return new Response('Failed to fetch transcript', { status: 500 })
  }
}
