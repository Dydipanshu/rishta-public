const VOICES = [
  ["aparna_hi_customer", "Sarvam's first choice for Hindi customer care"],
  ["aarti_hi_customer", "Sarvam's alternative for Hindi customer care"],
  ["ritu_hi_customer_warm", "Hindi customer care, warm"],
  ["simran_enhi_customer", "Hinglish customer care"],
  ["ishita_enhi_customer", "Hinglish customer care"],
  ["shalini_enhi_customer", "Hinglish customer care"],
];

// Pick by ear, then set SARVAM_TTS_VOICE. Clips come from scripts/spike/voiceSamples.ts.
export default function Voices() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-[30px] font-extrabold text-navy">Pick Rishta's voice</h1>
      <p className="text-muted">Each voice says the same real line. Tell Claude the number you like best.</p>
      <ol className="mt-4">
        {VOICES.map(([id, note], i) => (
          <li key={id} className="border-b border-line py-3">
            <div className="font-semibold">{i + 1}. {id}</div>
            <div className="text-sm text-muted">{note}</div>
            <audio controls preload="none" src={`/voices/${id}.mp3`} className="mt-1 w-full" />
          </li>
        ))}
      </ol>
    </main>
  );
}
