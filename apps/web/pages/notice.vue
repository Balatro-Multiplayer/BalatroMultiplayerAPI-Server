<script setup lang="ts">
useHead({ title: 'Privacy & Terms Notice — Balatro Multiplayer' })
</script>

<template>
	<BPanel variant="dark" class="legal-panel">
		<h1 class="legal-h1">Privacy &amp; Terms Notice</h1>
		<p class="legal-meta">Last updated: June 13, 2026</p>

		<div class="legal-body">
			<p>This notice explains how Balatro Multiplayer works, what data we collect, what we do with it, and your rights. It is written in plain language and constitutes the binding terms and privacy policy for the service.</p>
			<p>Balatro Multiplayer is operated by Connor Mills (Virtualized), based in Alberta, Canada. The mod and server software are open source under GPLv3. This notice only covers <strong>our</strong> instance at <a href="https://balatromp.com">balatromp.com</a> and subdomains; third-party instances are governed by whoever runs them.</p>
			<p>We are not affiliated with LocalThunk or Playstack.</p>
			<p>All user data is stored on servers located in Germany (Hetzner Online GmbH), within the European Economic Area.</p>
			<p>Contact: <a href="mailto:bmp@virtualized.dev">bmp@virtualized.dev</a></p>

			<hr class="legal-hr" />

			<h2>What we collect</h2>

			<p><strong>Account identifiers:</strong></p>
			<ul>
				<li><strong>A peppered hash of your Steam ID.</strong> When you authenticate through Steam, we receive your Steam ID from Valve. We immediately hash it with a pepper and discard the original. We do not access your friends list, game library, email, or any other Steam data.</li>
				<li><strong>Your Steam display name.</strong> Pulled from your Steam profile and updated each time you log in.</li>
				<li><strong>A salted hash of your IP address.</strong> Hashed on arrival; the plaintext IP is never stored. Used to enforce bans.</li>
				<li><strong>Discord display name and user ID (optional).</strong> Only if you link your Discord account. Your display name is pulled from Discord and updated each time you log in. You can unlink at any time.</li>
				<li><strong>Display name selection.</strong> You choose whether to show your Steam or Discord name. No custom display names are supported.</li>
			</ul>

			<p><strong>Age verification:</strong></p>
			<p>We ask your date of birth once, on the client side only. Your date of birth is never transmitted to our servers. The client evaluates your age locally and sends one of three flags to the server: under 13 (account creation blocked), 13–15 (account created, chat disabled), or 16+ (full access including chat). Only the flag is transmitted, never the date itself.</p>

			<p><strong>Chat messages:</strong></p>
			<p>If you are age-verified (16+), you can send messages selected from a predefined set we created. These preset message selections are logged with your account identifier and a timestamp.</p>

			<p><strong>Gameplay logs:</strong></p>
			<p>We record game action logs during matches. These contain in-game actions and your account identifier, no additional personal data. They are used for moderation, replay, and spectating features.</p>

			<p><strong>Cookies:</strong></p>
			<p>We use a session cookie for Steam OAuth authentication. This cookie is strictly necessary for the service to function. We do not use tracking, analytics, or advertising cookies.</p>

			<hr class="legal-hr" />

			<h2>Why we process your data</h2>
			<p>We process your data under the following legal bases (per GDPR Article 6(1)):</p>
			<ul>
				<li><strong>Contractual necessity (Art. 6(1)(b)):</strong> Account data and gameplay logs are necessary to provide the service you signed up for.</li>
				<li><strong>Legitimate interest (Art. 6(1)(f)):</strong> Hashed IP addresses, hashed Steam IDs, and moderation records are processed to maintain the security and integrity of the service, prevent abuse, and enforce bans. You may object to processing under this basis (see Your Rights).</li>
				<li><strong>Legal obligation (Art. 6(1)(c)):</strong> We may process and retain data where required by law, including child safety reporting obligations.</li>
				<li><strong>Consent (Art. 6(1)(a)):</strong> Optional features such as Discord account linking are based on your consent, which you can withdraw at any time by unlinking.</li>
			</ul>

			<hr class="legal-hr" />

			<h2>What we do with it</h2>
			<ul>
				<li>Operate the service and manage your account.</li>
				<li>Moderate behavior using gameplay logs and chat records.</li>
				<li>Enforce bans and prevent evasion using hashed identifiers.</li>
				<li>Provide replay and spectating features using gameplay logs.</li>
				<li>Comply with legal obligations, including child safety reporting.</li>
			</ul>
			<p>We do <strong>not</strong> sell your data. We do <strong>not</strong> use it for advertising. We do <strong>not</strong> share it with third parties except:</p>
			<ul>
				<li><strong>Valve Corporation (United States):</strong> Receives and responds to authentication requests during the Steam OAuth login flow. Governed by Valve's own privacy policy.</li>
				<li><strong>Hetzner Online GmbH (Germany):</strong> Hosts our infrastructure within the EEA. Acts as a data processor with access limited to infrastructure operation under their standard Data Processing Agreement.</li>
				<li><strong>Law enforcement or regulatory authorities:</strong> Only if legally compelled or required by mandatory reporting obligations.</li>
			</ul>

			<hr class="legal-hr" />

			<h2>Child safety and reporting</h2>
			<p>We are committed to child safety. We are registered as an Electronic Service Provider with the National Center for Missing &amp; Exploited Children (NCMEC).</p>
			<p>We will report any suspected child sexual abuse material (CSAM) or online exploitation of a child encountered on our service to:</p>
			<ul>
				<li><strong>NCMEC:</strong> through our registered Electronic Service Provider account, as our primary reporting channel</li>
				<li><strong>Cybertip.ca:</strong> the Canadian national tipline operated by the Canadian Centre for Child Protection, as a supplementary reporting channel</li>
				<li><strong>Law enforcement:</strong> as required by applicable law, including the Canadian Criminal Code (R.S.C. 1985, c. C-46, s. 163.1)</li>
			</ul>

			<hr class="legal-hr" />

			<h2>How long we keep it</h2>
			<ul>
				<li><strong>Account data</strong> (Steam display name, Discord display name, hashed IP, Discord link, age flag): retained for the life of your account. Deleted within 30 days of account deletion.</li>
				<li><strong>Peppered Steam ID hash:</strong> Retained after account deletion for the sole purpose of enforcing bans and preventing ban evasion. Reviewed and purged if no associated ban exists after 12 months post-deletion.</li>
				<li><strong>Chat message logs:</strong> 90 days from the date sent, then permanently deleted.</li>
				<li><strong>Gameplay logs:</strong> 180 days from the date of the match, then permanently deleted.</li>
				<li><strong>Moderation records</strong> (bans, flags, evidence): Duration of the ban plus 12 months. For permanent bans: retained indefinitely.</li>
			</ul>

			<hr class="legal-hr" />

			<h2>Account deletion</h2>
			<p>You can delete your account via the account page at <a href="https://balatromp.com">balatromp.com</a> or by emailing <a href="mailto:bmp@virtualized.dev">bmp@virtualized.dev</a>.</p>
			<p>When you delete your account:</p>
			<ul>
				<li>Your Steam display name, Discord display name, hashed IP address, Discord link, age verification flag, and chat logs are deleted or anonymized within 30 days.</li>
				<li>Your peppered Steam ID hash is retained solely to enforce active bans and prevent ban evasion. This hash cannot be reversed to recover your Steam ID. If you have no active ban, this hash is purged within 12 months.</li>
				<li>Anonymized, aggregate data (e.g., match statistics with no link to your identity) may be retained indefinitely.</li>
			</ul>
			<p>Chat message logs and gameplay logs associated with your account that fall within their standard retention periods (90 days and 180 days respectively) will be anonymized at the time of account deletion. Anonymized logs may be retained for the remainder of their standard retention period. Once the retention period expires, they are permanently deleted.</p>

			<hr class="legal-hr" />

			<h2>Security</h2>
			<p>We use TLS for data in transit, peppered and salted hashing for all stored identifiers, and role-based access controls. All data is stored within the EEA (Hetzner, Germany).</p>
			<p>No system is perfectly secure. In the event of a data breach, we will notify the relevant supervisory authority in accordance with GDPR Article 33 without undue delay. Where the breach is likely to result in a high risk to your rights and freedoms, we will also notify affected users in accordance with GDPR Article 34.</p>

			<hr class="legal-hr" />

			<h2>Age requirements</h2>
			<p>You must be at least 13 years old to create an account. If the client-side age check determines you are under 13, account creation is blocked.</p>
			<p>Users aged 13–15 may use the service but cannot access chat features. Chat, viewing and sending preset messages, is available only to users verified as 16 or older.</p>
			<p>If you are between 13 and the age of majority in your jurisdiction, your use of the service constitutes representation that you have the permission of a parent or legal guardian.</p>

			<hr class="legal-hr" />

			<h2>International data transfers</h2>
			<p>We are based in Canada. All user data is stored in Germany, within the EEA. Canada holds an adequacy decision from the European Commission (pursuant to GDPR Article 45), meaning data transfers between Germany and Canada are permitted under GDPR.</p>
			<p>Steam authentication involves communication with Valve Corporation in the United States. This is limited to the OAuth login flow and is governed by Valve's privacy policy and Steam's terms of service.</p>

			<hr class="legal-hr" />

			<h2>Account suspension and termination</h2>
			<p>We reserve the right to suspend or terminate any account for conduct including, but not limited to: cheating, exploiting, harassment, abuse of other users, circumventing bans, violating this notice, or any behavior that threatens the integrity or safety of the service. We may also suspend or terminate accounts for any other reason at our sole discretion. When practical, we will provide a reason.</p>
			<p>Suspended or terminated accounts remain subject to the data retention periods described above.</p>

			<hr class="legal-hr" />

			<h2>Your rights</h2>
			<p>Depending on your jurisdiction, you have the following rights regarding your personal data:</p>
			<ul>
				<li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
				<li><strong>Rectification:</strong> Request correction of inaccurate data. Display names are sourced from Steam and Discord; update them there and they will sync on your next login.</li>
				<li><strong>Erasure:</strong> Request deletion of your account and associated data, subject to the retained Steam ID hash for ban enforcement as described above.</li>
				<li><strong>Restriction:</strong> Request that we limit how we process your data while a concern is being resolved.</li>
				<li><strong>Data portability:</strong> Request your data in a structured, machine-readable format.</li>
				<li><strong>Objection:</strong> Object to processing based on legitimate interest. We will cease processing unless we demonstrate compelling grounds that override your interests.</li>
				<li><strong>Withdraw consent:</strong> For optional features (e.g., Discord linking), withdraw consent at any time with no effect on the lawfulness of prior processing.</li>
			</ul>
			<p><strong>How to exercise your rights:</strong> Use the account page at <a href="https://balatromp.com">balatromp.com</a> or email <a href="mailto:bmp@virtualized.dev">bmp@virtualized.dev</a>. We will respond within 30 days. If your request is complex, we may extend this by an additional 60 days with notice.</p>
			<p><strong>If you are unsatisfied with our response:</strong></p>
			<ul>
				<li><strong>EU/UK residents:</strong> You may lodge a complaint with the supervisory authority in your country. Since data is stored in Germany, the lead supervisory authority is the Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI).</li>
				<li><strong>Canadian residents:</strong> You may contact the Office of the Privacy Commissioner of Canada at <a href="https://priv.gc.ca">priv.gc.ca</a>.</li>
			</ul>

			<hr class="legal-hr" />

			<h2>Acceptance</h2>
			<p>By creating an account, you confirm that you have read and agree to this notice. Your agreement is recorded at the time of account creation. If you do not agree, do not create an account.</p>

			<hr class="legal-hr" />

			<h2>Changes to this notice</h2>
			<p>If we change this notice, we will update the date at the top and notify you in-app on your next login. Material changes, such as new data collection, new third-party sharing, or changes to your rights, will be clearly identified.</p>

			<hr class="legal-hr" />

			<h2>Limitation of liability</h2>
			<p>Balatro Multiplayer is a free, open-source mod provided "as is" without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. To the maximum extent permitted by law, we are not liable for downtime, data loss, service interruptions, or any direct, indirect, incidental, or consequential damages arising from your use of the service.</p>

			<hr class="legal-hr" />

			<h2>Governing law and jurisdiction</h2>
			<p>This notice and any disputes arising from it are governed by the laws of the Province of Alberta and the federal laws of Canada applicable therein, without regard to conflict-of-law principles. Before initiating any legal proceedings, both parties agree to attempt informal resolution via email (<a href="mailto:bmp@virtualized.dev">bmp@virtualized.dev</a>) for a period of 30 days. If informal resolution is unsuccessful, any legal proceedings must be brought exclusively in the courts of Alberta, Canada.</p>

			<hr class="legal-hr" />

			<p class="legal-footer">If you have questions about this notice or your data, contact <a href="mailto:bmp@virtualized.dev">bmp@virtualized.dev</a>.</p>
		</div>
	</BPanel>
</template>

<style scoped>
.legal-panel {
	max-width: 800px;
	margin: 0 auto;
	font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
	-webkit-font-smoothing: antialiased;
}

.legal-h1 {
	font-size: 22px;
	color: var(--bal-cream);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	margin-bottom: 8px;
	font-family: 'm6x11', monospace;
}

.legal-meta {
	font-size: 12px;
	color: var(--bal-gray-mid);
	margin-bottom: 32px;
}

.legal-body {
	display: flex;
	flex-direction: column;
	gap: 14px;
	color: var(--bal-gray-blue);
	font-size: 14px;
	line-height: 1.7;
}

.legal-body h2 {
	font-size: 16px;
	color: var(--bal-cream);
	margin-top: 4px;
	font-weight: 600;
}

.legal-body strong { color: var(--bal-white); }

.legal-body ul {
	padding-left: 24px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.legal-body a { color: var(--bal-blue); }
.legal-body a:hover { color: var(--bal-blue-light); }

.legal-hr {
	border: none;
	border-top: 1px solid rgba(255, 255, 255, 0.08);
	margin: 4px 0;
}

.legal-footer {
	color: var(--bal-gray-mid);
	font-size: 12px;
}
</style>
