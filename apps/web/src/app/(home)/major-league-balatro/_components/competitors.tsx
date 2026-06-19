import { PlayerCard } from '@/app/(home)/major-league-balatro/_components/player-card'
import { players } from '@/app/(home)/major-league-balatro/_constants/players'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function Competitors() {
  return (
    <section className='container py-8 md:py-12'>
      <div className='mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center'>
        <h2 className='font-bold text-3xl leading-tight tracking-tighter md:text-4xl'>
          The Competitors
        </h2>
        <p className='max-w-[85%] text-muted-foreground leading-normal sm:text-lg sm:leading-7'>
          12 talented creators split into Blue and Red divisions.
        </p>
      </div>

      <Tabs defaultValue='blue' className='mx-auto mt-8 max-w-5xl'>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='blue'>Blue Division</TabsTrigger>
          <TabsTrigger value='red'>Red Division</TabsTrigger>
        </TabsList>
        <TabsContent value='blue' className='mt-6'>
          <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3'>
            {Object.values(players)
              .filter((player) => player.division === 'Blue')
              .map((creator) => (
                <PlayerCard
                  name={creator.name}
                  socials={creator.socials}
                  picture={creator.picture}
                  key={creator.name}
                />
              ))}
          </div>
        </TabsContent>
        <TabsContent value='red' className='mt-6'>
          <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3'>
            {Object.values(players)
              .filter(
                (player) => player.division === 'Red' && player.id !== 'tbd'
              )
              .map((creator) => (
                <PlayerCard
                  name={creator.name}
                  socials={creator.socials}
                  picture={creator.picture}
                  key={creator.name}
                />
              ))}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
