// Decided by code, before the model, because these must never depend on a model's mood.
import { FRAUD_HELPLINE } from "../../config/value.js";

export type Route = "fraud" | "trust" | "human" | "optout" | "later" | "quiet" | "account" | null;

const FRAUD = /fraud|scam|धोखा|धोखाधड़ी|ठग|ठगी|फ्रॉड|फ्रॉड|पुलिस|police|कोर्ट|court|वकील|lawyer|कानूनी|legal/i;
const LOSS = /(otp|पिन|pin|ओटीपी)[^।?!.]{0,30}(बता दिया|दे दिया|शेयर|share|gave|told)|(खाते|account)[^।?!.]{0,20}(पैसे|money)?[^।?!.]{0,12}(कट गए|निकल गए|गायब)/i;
// "Is this a scam?" is a good question, not a fraud report.
const TRUST = /(is (this|it)|are you|क्या (यह|ये|तुम|आप)|kya|ye|yeh)[^।?!.]{0,25}(scam|fraud|fake|real|genuine|असली|नकली|फर्जी|फ़र्ज़ी|धोखा)|how (do|can) i (know|trust)|really paytm|(असली|सच में) paytm/i;
const ABUSE = /बेवकूफ|बकवास|मूर्ख|गधे|idiot|stupid|nonsense|bloody/i;
export const HIDDEN = "[number removed]";
// Account, card and phone numbers never reach the model, the transcript or the logs.
export const hideLongNumbers = (text: string) => text.replace(/\d(?:[\s-]?\d){8,}/g, HIDDEN);
const HUMAN = /(इंसान|आदमी|व्यक्ति|किसी से|manager|मैनेजर|agent|executive|human|real person|a person)[^।?!.]{0,25}(बात|बुलाओ|बात कराओ|बात करनी|दो|talk|speak|connect)/i;
const OPT_OUT = /(contact|संपर्क|call|फ़ोन|फोन|message|मैसेज)[^।?!.]{0,14}(मत|नहीं करना|बंद)|(दोबारा|फिर से)[^।?!.]{0,20}मत|बंद करो ये|ये सब बंद|don'?t (contact|call|message)|stop (contacting|calling|messaging)|leave me alone/i;
const LATER = /बाद में[^।?!.]{0,12}(बात|करो|करना|कीजिए|बोलो)|अभी[^।?!.]{0,10}(busy|व्यस्त|टाइम नहीं|समय नहीं)|ग्राहक खड़े|talk later|call (me )?later|i'?m busy|not now/i;
const QUIET = /(ज़ोर|जोर)[^।?!.]{0,6}से[^।?!.]{0,6}मत|धीरे बोल|ग्राहक सुन|सब सुन रहे|don'?t say (it|that) (out )?loud|customers can hear|keep (it|your voice) (down|low)/i;

export function routeTurn(text: string): Route {
  if (LOSS.test(text)) return "fraud";
  if (TRUST.test(text)) return "trust";
  if (FRAUD.test(text)) return "fraud";
  if (ABUSE.test(text) || HUMAN.test(text)) return "human";
  if (OPT_OUT.test(text)) return "optout";
  if (text.includes(HIDDEN)) return "account";
  if (QUIET.test(text)) return "quiet";
  if (LATER.test(text)) return "later";
  return null;
}

// Fixed lines: [Hindi, English].
export const LINES = {
  fraud: [`जी, यह गंभीर है। अभी अपना PIN बदलिए और ${FRAUD_HELPLINE} पर call कीजिए। Paytm की fraud team का एक व्यक्ति आपको call करेगा।`, `This is serious. Change your PIN now and call ${FRAUD_HELPLINE}. A person from Paytm's fraud team will call you.`],
  trust: ["जाँच करना बिल्कुल सही है। मैं Paytm की AI assistant हूँ। मैं OTP, PIN या bank details कभी नहीं माँगूँगी और कोई link नहीं भेजूँगी। अपना हिसाब आप खुद Paytm for Business app में देख सकते हैं।", "You're right to check. I'm Paytm's AI assistant. I will never ask for an OTP, PIN or bank details, and I won't send links. You can see your own figures in the Paytm for Business app."],
  account: ["जी, account या card का number मुझे मत बताइए, मुझे इसकी ज़रूरत नहीं। मैंने उसे हटा दिया है। बताइए, क्या दिक्कत है?", "Please don't share account or card numbers, I don't need them. I've removed it. What's the problem?"],
  loanNoted: ["जी, वे आपको call करेंगे। अब आपकी बात पर आते हैं, क्या दिक्कत है?", "They will call you. Now, what was the problem?"],
  loanSkipped: ["जी, कोई बात नहीं। बताइए, और क्या दिक्कत है?", "No problem. What else can I help with?"],
  again: ["जी, मैं समझ नहीं पाई। कृपया एक बार फिर बताइए।", "Sorry, I didn't catch that. Please say it once more."],
  human: ["जी, Paytm से एक व्यक्ति आपको call करेगा। उन्हें आपकी पूरी बात मिल जाएगी, दोबारा बताना नहीं पड़ेगा।", "A person from Paytm will call you. They will have this whole conversation, so you won't need to repeat it."],
  optout: ["जी, अब हम खुद आपसे संपर्क नहीं करेंगे। जब भी ज़रूरत हो, बटन दबाकर पूछ सकते हैं। धन्यवाद।", "We won't contact you again. You can still press the button whenever you need us. Thank you."],
  later: ["जी, ज़रूर। आप ग्राहक देखिए। जब फ़ुर्सत हो, बटन दबाकर पूछ लीजिएगा।", "Of course. Look after your customers. Press the button whenever you have a moment."],
  quiet: ["जी, समझ गई। मैं रकम बोलकर नहीं बताऊँगी। पूरा हिसाब आपके app में भेज रही हूँ।", "Understood. I won't say amounts aloud. The full details are going to your app."],
  hold: ["जी, आपकी बात एक व्यक्ति तक पहुँच चुकी है। मैंने आपकी यह बात भी जोड़ दी है, वही आपको call करेंगे।", "A person already has your case. I've added what you just said, and they will call you."],
} as const;
