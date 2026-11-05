// Any change to the Notice text must raise NOTICE_VERSION (and NOTICE_DATE) in @bmp/types notice.ts in the same commit.
import { NOTICE_DATE } from '@bmp/types'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy & Terms Notice',
}

const lastUpdated = new Date(`${NOTICE_DATE}T00:00:00Z`).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

export default function NoticePage() {
  return (
    <div className='container max-w-3xl py-10'>
      <div
        className='rounded-lg border border-border bg-card p-8 space-y-4'
      >
        <h1 className='text-2xl font-bold' style={{ textShadow: '3px 3px 0 rgba(0,0,0,0.4)' }}>
          Privacy &amp; Terms Notice
        </h1>
        <p className='text-xs text-muted-foreground' style={{ marginBottom: 32 }}>Last updated: {lastUpdated}</p>

        <div className='space-y-3.5 text-sm leading-relaxed text-muted-foreground'>
          <p>This notice explains how Balatro Multiplayer works, what data we collect, what we do with it, and your rights. It is written in plain language and constitutes the binding terms and privacy policy for the service.</p>
          <p>Balatro Multiplayer is operated by Connor Mills (Virtualized), based in Alberta, Canada. The mod and server software are open source under GPLv3. This notice only covers <strong className='text-foreground'>our</strong> Official server at <a href='https://balatromp.com' className='text-blue-400 hover:text-blue-300'>balatromp.com</a> and subdomains. Anyone can run their own server with our software. If you play on a server that someone else runs, this notice does not apply there: that server is governed by whoever runs it, and our server does not ask you to accept this notice for it.</p>
          <p>We are not affiliated with LocalThunk or Playstack.</p>
          <p>All user data is stored on servers located in Germany (Hetzner Online GmbH), within the European Economic Area.</p>
          <p>Contact: <a href='mailto:bmp@virtualized.dev' className='text-blue-400 hover:text-blue-300'>bmp@virtualized.dev</a></p>

          <Hr />

          <H2>What we collect</H2>

          <p><strong className='text-foreground'>Account identifiers:</strong></p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li><strong className='text-foreground'>A peppered hash of your Steam ID.</strong> When you log in, Steam (Valve) confirms your Steam ID to us. We hash it at once with a secret pepper. Your account is named by this hash. The plain Steam ID is only in memory during the login, and we never store it. We do not access your friends list, game library, email, or any other Steam data.</li>
            <li><strong className='text-foreground'>Your Steam display name.</strong> Your game sends it each time you log in. When you log in to the website, we ask Steam for it.</li>
            <li><strong className='text-foreground'>A salted hash of your network.</strong> Each time you log in, we hash your IP address with a secret salt. For an IPv6 address, we hash only the first half (the /64 network prefix). We store the hash and the time of your last login from that network. We do not store the IP address itself with your account, and our web server access logs leave it out. Plain IP addresses appear only in our web server error log, which records failed requests. We keep it for at most 7 days. We use these hashes only for network bans (see Bans).</li>
            <li><strong className='text-foreground'>A peppered hash of your Discord user ID, and your Discord display name (optional).</strong> Only if you link your Discord account. We hash the Discord user ID at once and do not store it. We take your Discord display name when you link. You can unlink at any time.</li>
            <li><strong className='text-foreground'>Your settings.</strong> Whether to show your Steam or Discord name (no custom display names are supported), the avatar you pick, and the players you mute.</li>
          </ul>

          <p><strong className='text-foreground'>Age:</strong></p>
          <p>We ask your date of birth once. The game or the website works out your age on your device. Your date of birth is never sent to our servers. If you are under 13, you cannot accept this notice and nothing is sent. Otherwise only one answer is sent: whether you are 16 or older. We store that answer as your chat access.</p>

          <p><strong className='text-foreground'>Chat messages:</strong></p>
          <p>If you are 16 or older and you turn chat on, you can type your own messages, up to 500 characters each. Other players in your lobby see them. Before a message is published, our systems check it: word lists and rules we wrote, and a moderation model that we run ourselves, on our own servers. No outside AI service sees your messages. The check also looks at the last few messages in the lobby. A message is published exactly as you typed it, or it is blocked. A message with a link to a website that is not on our approved list is blocked. We log every message, published or blocked, with your account identifier, the lobby and the time. Our moderators review blocked messages, and published messages that the model marks for review (flagged messages).</p>

          <p><strong className='text-foreground'>Gameplay logs:</strong></p>
          <p>We record game action logs during matches. These contain in-game actions and your account identifier, no additional personal data. They are used for moderation, replay, and spectating features. We check them automatically for signs of cheating. A game that fails a check, or whose result the players dispute, goes to our moderators.</p>

          <p><strong className='text-foreground'>Installed mods:</strong></p>
          <p>Each time you log in, your game sends us the list of mods you have turned on, with their versions. We keep the latest list with your account. Other players in your lobby can see it. Matchmaking on our server accepts only approved mods.</p>

          <p><strong className='text-foreground'>Launcher checks:</strong></p>
          <p>Ranked matchmaking needs a game started by the official launcher. When you use it, our server sends your game checks, at login and from time to time while you play. If a check fails, times out or is refused, we record its type, the reason and the time.</p>

          <p><strong className='text-foreground'>Player reports:</strong></p>
          <p>You can report another player from your lobby. A report holds who sent it, who it is about, the reason, the text you write (up to 500 characters), the game it is about, and the recent chat in that lobby. Our moderators use reports, with the logs above, as evidence.</p>

          <p><strong className='text-foreground'>Ratings, seasons and achievements:</strong></p>
          <p>We keep your match results, your rating for each season, and your achievement progress. The website leaderboards and player pages are public. They show your display name, avatar, rating, rank, wins, losses and the date your account was made.</p>

          <p><strong className='text-foreground'>Website login and browser storage:</strong></p>
          <p>You log in to the website with Steam OpenID: Steam confirms your Steam ID, and we hash it as above. The website then keeps a login token in your browser's local storage. It may also keep your reduced-motion setting, and the reskin tool may keep the game file you choose; these stay on your device. The website does not use cookies for login, tracking, analytics, or advertising.</p>

          <Hr />

          <H2>Why we process your data</H2>
          <p>We process your data under the following legal bases (per GDPR Article 6(1)):</p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li><strong className='text-foreground'>Contractual necessity (Art. 6(1)(b)):</strong> Account data, gameplay logs, match results, ratings and achievements are necessary to provide the service you signed up for.</li>
            <li><strong className='text-foreground'>Legitimate interest (Art. 6(1)(f)):</strong> Network hashes, hashed Steam IDs, chat checks, installed-mod lists, launcher checks, player reports and moderation records are processed to maintain the security and integrity of the service, prevent abuse, and enforce bans. You may object to processing under this basis (see Your Rights).</li>
            <li><strong className='text-foreground'>Legal obligation (Art. 6(1)(c)):</strong> We may process and retain data where required by law, including child safety reporting obligations.</li>
            <li><strong className='text-foreground'>Consent (Art. 6(1)(a)):</strong> Optional features such as Discord account linking are based on your consent, which you can withdraw at any time by unlinking.</li>
          </ul>

          <Hr />

          <H2>What we do with it</H2>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li>Operate the service and manage your account.</li>
            <li>Check chat before it is published, and moderate behavior using gameplay logs, chat records and player reports.</li>
            <li>Enforce bans and prevent evasion using hashed identifiers.</li>
            <li>Run ranked matchmaking, ratings, seasons, leaderboards and achievements.</li>
            <li>Provide replay and spectating features using gameplay logs.</li>
            <li>Comply with legal obligations, including child safety reporting.</li>
          </ul>
          <p>We do <strong className='text-foreground'>not</strong> sell your data. We do <strong className='text-foreground'>not</strong> use it for advertising. We do <strong className='text-foreground'>not</strong> share it with third parties except:</p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li><strong className='text-foreground'>Valve Corporation (United States):</strong> Confirms your Steam login (the game's login ticket, and Steam OpenID on the website) and gives us your Steam display name. Governed by Valve's own privacy policy.</li>
            <li><strong className='text-foreground'>Discord Inc. (United States):</strong> Only if you link Discord. Discord confirms your Discord account and gives us your user ID and display name. We ask Discord only for this basic profile. Governed by Discord's own privacy policy.</li>
            <li><strong className='text-foreground'>Hetzner Online GmbH (Germany):</strong> Hosts our infrastructure within the EEA. Acts as a data processor with access limited to infrastructure operation under their standard Data Processing Agreement.</li>
            <li><strong className='text-foreground'>Law enforcement or regulatory authorities:</strong> Only if legally compelled or required by mandatory reporting obligations.</li>
          </ul>

          <Hr />

          <H2>Child safety and reporting</H2>
          <p>We are committed to child safety. We are registered as an Electronic Service Provider with the National Center for Missing &amp; Exploited Children (NCMEC).</p>
          <p>We will report any suspected child sexual abuse material (CSAM) or online exploitation of a child encountered on our service to:</p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li><strong className='text-foreground'>NCMEC:</strong> through our registered Electronic Service Provider account, as our primary reporting channel</li>
            <li><strong className='text-foreground'>Cybertip.ca:</strong> the Canadian national tipline operated by the Canadian Centre for Child Protection, as a supplementary reporting channel</li>
            <li><strong className='text-foreground'>Law enforcement:</strong> as required by applicable law, including the Canadian Criminal Code (R.S.C. 1985, c. C-46, s. 163.1)</li>
          </ul>

          <Hr />

          <H2>How long we keep it</H2>
          <p>Evidence means blocked or flagged chat messages and gameplay logs. A report or ban that uses a piece of evidence is open while the report is not resolved, or while the ban is in force.</p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li><strong className='text-foreground'>Account data</strong> (Steam display name, Steam ID hash, Discord ID hash and display name, settings, chat access, installed-mod list, the notice version you accepted): kept while your account exists. See Account deletion.</li>
            <li><strong className='text-foreground'>Web server error log</strong> (the only place a plain IP address appears): at most 7 days, then deleted.</li>
            <li><strong className='text-foreground'>Network hashes:</strong> 30 days after your last login from that network, then deleted. A hash that is part of a network ban is kept until an admin lifts the ban.</li>
            <li><strong className='text-foreground'>Chat messages:</strong> 90 days from the date sent, then permanently deleted.</li>
            <li><strong className='text-foreground'>Blocked or flagged chat messages:</strong> 180 days from the date sent. If a report or ban uses one, we keep it while that report or ban is open, then 180 more days.</li>
            <li><strong className='text-foreground'>Gameplay logs:</strong> 180 days from the end of the match. If a report or ban uses one, we keep it while that report or ban is open, then 180 more days.</li>
            <li><strong className='text-foreground'>Chat saved with a report:</strong> kept while a report about that lobby is open, then 180 more days.</li>
            <li><strong className='text-foreground'>Ban records:</strong> the length of the ban plus 12 months. For permanent bans: retained indefinitely.</li>
            <li><strong className='text-foreground'>Reports, warnings, moderation decisions and failed launcher checks:</strong> 180 days from when they were made. While the report or moderation case is open, or while a ban from it is in force, we keep them, then 180 more days.</li>
            <li><strong className='text-foreground'>Match results, ratings and season standings:</strong> kept for the life of your account, because leaderboards and other players' match history depend on them. If you delete your account, your ratings and season standings are deleted, and your side of each match with other players stays under the deleted-player ID (see Account deletion).</li>
          </ul>

          <Hr />

          <H2>Account deletion</H2>
          <p>You can delete your account via your profile page at <a href='https://balatromp.com' className='text-blue-400 hover:text-blue-300'>balatromp.com</a> or by emailing <a href='mailto:bmp@virtualized.dev' className='text-blue-400 hover:text-blue-300'>bmp@virtualized.dev</a>.</p>
          <p>When you delete your account on the website, this happens at once:</p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li>Your own data is deleted: your Steam display name, Discord ID hash and display name, network hashes, settings, chat access, installed-mod list, ratings, season standings, achievements, chat messages, gameplay logs, and matches that no other player played. The only exception is evidence, in the moderation records below.</li>
            <li>Matches you played with other players stay, so their history and ratings stay whole. In them, your player ID is replaced by one fixed deleted-player ID that all deleted accounts share, and your name becomes "[deleted player]". That ID identifies nobody and is never linked to an account.</li>
            <li>Moderation records stay under a new random ID: bans, network bans, reports you made or that are about you, warnings, moderation decisions, failed launcher checks, and evidence that is still within its limit above (blocked or flagged chat, chat saved with a report, and gameplay logs that an open report or ban uses). Nothing links that random ID back to you. Each record is deleted at its normal limit above.</li>
            <li>If a network ban holds some of your network hashes, the ban keeps its copy of them until an admin lifts it. Nothing in it names you: it names the random ID.</li>
            <li>If you have no ban record, we delete your Steam ID hash too.</li>
            <li>If you have a ban record, we keep your Steam ID hash with the anonymous record, so the ban still applies if you come back. This hash cannot be reversed to recover your Steam ID. When 12 months have passed since deletion and no ban is in force, we delete it. For a permanent ban we keep it.</li>
            <li>If you log in again with the same Steam account while we keep your Steam ID hash, your account comes back with only the moderation records above, and any ban still in force applies. Your deleted data does not come back.</li>
          </ul>

          <Hr />

          <H2>Security</H2>
          <p>We use TLS for data in transit, peppered and salted hashing for your Steam ID, Discord ID and network, and role-based access controls. All data is stored within the EEA (Hetzner, Germany).</p>
          <p>No system is perfectly secure. In the event of a data breach, we will notify the relevant supervisory authority in accordance with GDPR Article 33 without undue delay. Where the breach is likely to result in a high risk to your rights and freedoms, we will also notify affected users in accordance with GDPR Article 34.</p>

          <Hr />

          <H2>Age requirements</H2>
          <p>You must be at least 13 years old to use the service. If the age check on your device finds you are under 13, you cannot accept this notice and cannot play online.</p>
          <p>Users aged 13 to 15 may use the service but cannot access chat. Chat, reading and sending messages, is available only to users who are 16 or older.</p>
          <p>If you are between 13 and the age of majority in your jurisdiction, your use of the service constitutes representation that you have the permission of a parent or legal guardian.</p>

          <Hr />

          <H2>International data transfers</H2>
          <p>We are based in Canada. All user data is stored in Germany, within the EEA. Canada holds an adequacy decision from the European Commission (pursuant to GDPR Article 45), meaning data transfers between Germany and Canada are permitted under GDPR.</p>
          <p>Some services we use are in the United States. Valve confirms your Steam login and gives us your Steam display name. Discord does the same for your Discord account, only if you link it. Each is governed by its own privacy policy and terms.</p>

          <Hr />

          <H2>Bans</H2>
          <p>An admin can ban an account from chat, from matchmaking, or from all online play (an account ban). A ban can be timed or permanent.</p>
          <p>A permanent account ban also bans the networks that the account logged in from in the last 30 days (a network ban). While a network ban is in force, no account can log in from those networks. A network ban stays until an admin lifts it. Lifting the account ban does not lift it. A timed ban never bans a network.</p>
          <p>If your network is banned, you see "Your network is banned from online play" and how to appeal. You do not see which account caused it. To appeal any ban, email <a href='mailto:bmp@virtualized.dev' className='text-blue-400 hover:text-blue-300'>bmp@virtualized.dev</a>.</p>

          <Hr />

          <H2>Account suspension and termination</H2>
          <p>We reserve the right to suspend or terminate any account for conduct including, but not limited to: cheating, exploiting, harassment, abuse of other users, circumventing bans, violating this notice, or any behavior that threatens the integrity or safety of the service. We may also suspend or terminate accounts for any other reason at our sole discretion. When practical, we will provide a reason.</p>
          <p>Suspended or terminated accounts remain subject to the data retention periods described above.</p>

          <Hr />

          <H2>Your rights</H2>
          <p>Depending on your jurisdiction, you have the following rights regarding your personal data:</p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li><strong className='text-foreground'>Access:</strong> Request a copy of the personal data we hold about you.</li>
            <li><strong className='text-foreground'>Rectification:</strong> Request correction of inaccurate data. Display names are sourced from Steam and Discord. Change your Steam name on Steam and it updates on your next login. Change your Discord name on Discord, then link Discord again.</li>
            <li><strong className='text-foreground'>Erasure:</strong> Request deletion of your account and associated data, subject to the retained Steam ID hash for ban enforcement as described above.</li>
            <li><strong className='text-foreground'>Restriction:</strong> Request that we limit how we process your data while a concern is being resolved.</li>
            <li><strong className='text-foreground'>Data portability:</strong> Request your data in a structured, machine-readable format.</li>
            <li><strong className='text-foreground'>Objection:</strong> Object to processing based on legitimate interest. We will cease processing unless we demonstrate compelling grounds that override your interests.</li>
            <li><strong className='text-foreground'>Withdraw consent:</strong> For optional features (e.g., Discord linking), withdraw consent at any time with no effect on the lawfulness of prior processing.</li>
          </ul>
          <p><strong className='text-foreground'>How to exercise your rights:</strong> Use the account page at <a href='https://balatromp.com' className='text-blue-400 hover:text-blue-300'>balatromp.com</a> or email <a href='mailto:bmp@virtualized.dev' className='text-blue-400 hover:text-blue-300'>bmp@virtualized.dev</a>. We will respond within 30 days. If your request is complex, we may extend this by an additional 60 days with notice.</p>
          <p><strong className='text-foreground'>If you are unsatisfied with our response:</strong></p>
          <ul className='pl-6 space-y-1.5 list-disc'>
            <li><strong className='text-foreground'>EU/UK residents:</strong> You may lodge a complaint with the supervisory authority in your country. Since data is stored in Germany, the lead supervisory authority is the Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI).</li>
            <li><strong className='text-foreground'>Canadian residents:</strong> You may contact the Office of the Privacy Commissioner of Canada at <a href='https://priv.gc.ca' className='text-blue-400 hover:text-blue-300'>priv.gc.ca</a>.</li>
          </ul>

          <Hr />

          <H2>Acceptance</H2>
          <p>Before you play online on our server, the game or the website asks you to accept this notice. We record which version you accepted and when. If you do not agree, do not accept: you cannot play online on our server. Your login still makes a basic account (your Steam ID hash and Steam display name), which you can delete as described above.</p>

          <Hr />

          <H2>Changes to this notice</H2>
          <p>If we change this notice, we update the date at the top and give it a new version number. At your next login, the game or the website asks you to accept the new version before you play online. Material changes, such as new data collection, new third-party sharing, or changes to your rights, will be clearly identified.</p>

          <Hr />

          <H2>Limitation of liability</H2>
          <p>Balatro Multiplayer is a free, open-source mod provided "as is" without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. To the maximum extent permitted by law, we are not liable for downtime, data loss, service interruptions, or any direct, indirect, incidental, or consequential damages arising from your use of the service.</p>

          <Hr />

          <H2>Governing law and jurisdiction</H2>
          <p>This notice and any disputes arising from it are governed by the laws of the Province of Alberta and the federal laws of Canada applicable therein, without regard to conflict-of-law principles. Before initiating any legal proceedings, both parties agree to attempt informal resolution via email (<a href='mailto:bmp@virtualized.dev' className='text-blue-400 hover:text-blue-300'>bmp@virtualized.dev</a>) for a period of 30 days. If informal resolution is unsuccessful, any legal proceedings must be brought exclusively in the courts of Alberta, Canada.</p>

          <Hr />

          <p className='text-xs text-muted-foreground'>If you have questions about this notice or your data, contact <a href='mailto:bmp@virtualized.dev' className='text-blue-400 hover:text-blue-300'>bmp@virtualized.dev</a>.</p>
        </div>
      </div>
    </div>
  )
}

function Hr() {
  return <hr className='border-t border-white/8 my-1' />
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className='text-base font-semibold text-foreground mt-1'>{children}</h2>
}
