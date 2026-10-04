import type { ReactNode } from 'react'
import { Accordion } from 'radix-ui'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

interface Section {
  id: string
  title: string
  body: ReactNode
}

const SECTIONS: Section[] = [
  {
    id: 'phases',
    title: 'The attack in four steps',
    body: (
      <>
        <p>
          Trying every full key is hopeless, so the key is recovered piece by piece. Each step keeps
          only the most promising settings and hands them to the next.
        </p>
        <ol className="list-decimal pl-5 [&>li+li]:mt-2">
          <li>
            <strong>Rotor order &amp; start positions.</strong> For every reflector, every ordered
            choice of three rotors and all 26 × 26 × 26 = 17,576 start positions, the message is
            decrypted and scored by its <em>index of coincidence</em> (IoC): the chance that two
            letters picked at random are the same. Language text repeats letters far more often than
            random text (≈ 0.066 for English, 0.076 for German, 0.038 for random letters). With ten
            cables the plain IoC is too weak on a few hundred letters, so each position also gets a
            quick plugboard pass under a few likely ring/turnover timings. The most promising tenth
            then tries <em>every</em> right-ring timing and every moment the left rotor could turn
            over — a turnover a few letters off garbles enough text to hide the right key — and is
            ranked by how often its letter <em>pairs</em> occur in the language (bigrams), which
            separates real text from lucky noise far better than the IoC. The best thousand
            settings survive.
          </li>
          <li>
            <strong>Ring settings.</strong> A ring setting mostly just shifts the start position;
            it only matters for <em>when</em> a rotor carries its left neighbour. For each survivor
            the right (and middle) ring is tried in all 26 positions, moving the start position to
            compensate, and the IoC is measured again.
          </li>
          <li>
            <strong>Plugboard.</strong> With the rotors fixed, plugboard cables are added by{' '}
            <em>hill climbing</em>: try every swap of two letters, keep the one that improves the
            score most, repeat until nothing helps (with random restarts). The score starts as the
            IoC and switches to n-gram statistics (how likely each run of three or four letters is in
            the chosen language), which can tell real words from noise. With the plugboard solved,
            every ring timing is tried once more on the full text: that repairs keys whose turnover
            is one step early or late and garbles one stretch of the message.
          </li>
          <li>
            <strong>Dictionary check.</strong> The best 20 keys are decrypted and the text is split
            into dictionary words (German or English, plus Enigma-era terms like OBERKOMMANDO or
            ZWO), allowing a few wrong letters per word. The share of letters that form words
            separates the right key (usually 85–100%) from wrong ones (below about 30%) and re-ranks
            the candidates; a near miss gets one more plugboard pass aimed at repairing broken
            words.
          </li>
        </ol>
        <p>
          A crib, a word known to be in the message, narrows the search and helps to rank
          candidates.
        </p>
      </>
    ),
  },
  {
    id: 'gpu',
    title: 'Running on your graphics card (WebGPU)',
    body: (
      <>
        <p>
          Step 1 is almost all of the work: millions of independent plugboard hill climbs, one per
          rotor order, start position and ring timing. That is exactly what a graphics card is
          built for, so when your browser offers WebGPU the climbs run as compute shaders on your
          GPU — thousands at once, a team of 32 GPU threads per candidate trying 32 cable swaps at
          a time.
        </p>
        <ul className="list-disc pl-5 [&>li+li]:mt-2">
          <li>
            <strong>Same answer, faster.</strong> The GPU reproduces the CPU search bit for bit:
            the same candidates, the same whole-number scores and the same order in which cable
            swaps are accepted. Which processor handled a rotor order never changes the result.
          </li>
          <li>
            <strong>GPU and CPU together.</strong> The GPU and the CPU workers take rotor orders
            from one queue. When the queue runs dry the GPU re-runs the orders the CPU is still on;
            whichever finishes first counts. The progress shows how many each one solved.
          </li>
          <li>
            <strong>On your device only.</strong> Nothing is uploaded — the shader, the statistics
            and your ciphertext stay in this browser tab. Without WebGPU, or if the graphics driver
            fails, the CPU simply does all the work.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'why',
    title: 'Why Enigma can be broken this way',
    body: (
      <ul className="list-disc pl-5 [&>li+li]:mt-2">
        <li>
          <strong>The plugboard is a reciprocal swap.</strong> It exchanges pairs of letters on the
          way in and again on the way out. With ten cables six letters stay unplugged, so a decrypt
          with the right rotors but no plugboard still keeps some of the language's letter
          statistics, enough for the IoC to notice. That lets the rotors be attacked separately from the plugboard.
        </li>
        <li>
          <strong>The rotors step like an odometer.</strong> The right rotor moves on every key
          press, the middle one only once every 26 letters, the left one hardly ever. In a message of
          a few hundred letters most of the key is fixed, so a nearly right setting gives a nearly
          right decrypt, and small improvements can be climbed one at a time.
        </li>
        <li>
          <strong>No letter ever encrypts to itself.</strong> The reflector sends the current back on
          a different wire. Codebreakers used this to place cribs: a guessed word cannot sit where
          any of its letters lines up with the same ciphertext letter.
        </li>
        <li>
          <strong>Ring settings barely matter.</strong> The left ring has no effect beyond the start
          position at all, and the others only affect where turnovers fall, so they can be found
          last.
        </li>
      </ul>
    ),
  },
  {
    id: 'keyspace',
    title: 'How big is the keyspace?',
    body: (
      <>
        <p>
          An Army Enigma I with five rotors and ten plugboard cables has 60 rotor orders × 17,576
          start positions × about 1.5 × 10<sup>14</sup> plugboard wirings ≈ 1.6 × 10<sup>20</sup>{' '}
          keys, before counting ring settings. At a hundred million keys per second, testing them
          all would take some fifty thousand years.
        </p>
        <p>
          Splitting the key changes that: step one tests about a million settings per reflector
          (60 × 17,576), step two a few hundred per survivor, and the plugboard climb a few
          thousand swaps per candidate. That is tens to hundreds of millions of decrypts in total,
          seconds to minutes on a modern CPU. The four-rotor M4 multiplies step one by up to 52
          (two Greek wheels × 26 positions) and allows eight rotors (336 orders), which is why it
          takes far longer.
        </p>
      </>
    ),
  },
  {
    id: 'history',
    title: 'History: Bletchley Park and the papers behind this',
    body: (
      <>
        <p>
          During the war, Enigma was broken at Bletchley Park with cribs and machines: the
          Turing–Welchman <em>bombe</em> tested rotor settings against a guessed piece of plaintext,
          building on the Polish Cipher Bureau's earlier work (Rejewski, Różycki, Zygalski). Those
          methods relied on cribs; scoring the statistics of whole decrypts needs a computer.
        </p>
        <p>
          The ciphertext-only attack used here comes later. James Gillogly showed in{' '}
          <cite>“Ciphertext-only Cryptanalysis of Enigma”</cite> (Cryptologia, 1995) that the IoC
          finds the rotors and that the plugboard can be climbed. Geoff Sullivan and Frode Weierud
          refined it with better ring searches and n-gram scoring in{' '}
          <cite>“Breaking German Army Ciphers”</cite> (Cryptologia, 2005) and used it on a
          collection of original wartime messages.
        </p>
      </>
    ),
  },
]

/** "How it works:" accordion explaining the attack, its feasibility, keyspace and history. */
export function HowItWorks({ className }: { className?: string }) {
  return (
    <section aria-labelledby="breaker-how-title" className={cn('min-w-0', className)}>
      <h2 id="breaker-how-title" className="mb-2 text-base font-normal">
        How it works:
      </h2>
      <Accordion.Root type="multiple" className="flex flex-col gap-2">
        {SECTIONS.map((s) => (
          <Accordion.Item
            key={s.id}
            value={s.id}
            className="rounded-md border border-border transition-colors hover:border-border-strong has-[:focus-visible]:border-fg-emphasis"
          >
            <Accordion.Header className="m-0">
              <Accordion.Trigger className="group flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left font-medium outline-none sm:px-4">
                {s.title}
                <ChevronDownIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
                />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="px-3 pb-4 text-sm leading-6 sm:px-4 [&_p+ol]:mt-2 [&_p+p]:mt-2 [&_ol+p]:mt-2">
              {s.body}
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  )
}
