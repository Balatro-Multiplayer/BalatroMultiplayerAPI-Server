import { Heart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export function PrizePool() {
  return (
    <section className='container py-8 md:py-12'>
      <div className='mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center'>
        <h2 className='font-bold text-3xl leading-tight tracking-tighter md:text-4xl'>
          Prize Pool
        </h2>
        <p className='max-w-[85%] text-muted-foreground leading-normal sm:text-lg sm:leading-7'>
          Playing for charity and glory.
        </p>
      </div>

      <div className='mx-auto mt-8 max-w-3xl'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center justify-center gap-2'>
              <Heart className='h-5 w-5 text-red-500' />
              Charity Prize Pool
            </CardTitle>
          </CardHeader>
          <CardContent className='text-center'>
            <div className='mb-4 font-bold text-5xl'>
              $500<span className='text-red-500'>+</span>
            </div>
            <p className='mb-6 text-muted-foreground'>
              The prize pool is creator-funded and will be donated to the
              winner's charity of choice. We're hoping to add to this amount as
              the tournament progresses.
            </p>
            <Separator className='my-6' />
            <div className='text-muted-foreground text-sm'>
              Each creator is playing for a charity of their choice. The full
              amount will be donated to the champion's selected charity at the
              conclusion of the tournament.
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
