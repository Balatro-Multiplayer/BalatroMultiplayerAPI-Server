import { Trophy, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function TournamentFormat() {
  return (
    <section id='format' className='container py-8 md:py-12'>
      <div className='mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center'>
        <h2 className='font-bold text-3xl leading-tight tracking-tighter md:text-4xl'>
          Tournament Format
        </h2>
        <p className='max-w-[85%] text-muted-foreground leading-normal sm:text-lg sm:leading-7'>
          Major League Balatro features 12 creators competing in a structured
          league format.
        </p>
      </div>

      <div className='mx-auto mt-8 grid max-w-5xl gap-8 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Users className='h-5 w-5 text-red-500' />
              League Structure
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <ul className='space-y-2'>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • 12 creators split into 2 divisions (Blue & Red)
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • Each creator plays 5 matches (one against each division
                  member)
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • 1st place in each division advances to Final Four
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • 2nd and 3rd place enter a playoff round robin
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • Top 2 from playoff round robin advance to Final Four
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • Finals on Saturday, May 17th, 2025
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Trophy className='h-5 w-5 text-red-500' />
              Match Format
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <ul className='space-y-2'>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • League matches: Best of 3 games
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • Playoff matches: Best of 5 games
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • 1 point per game win + 1 point for match win
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • Alternating deck and stake selection
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • Vanilla ruleset (no multiplayer jokers)
                </span>
              </li>
              <li className='flex items-start gap-2'>
                <span className='font-medium'>
                  • PvP battles after Ante-1 where lower score loses a life
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
