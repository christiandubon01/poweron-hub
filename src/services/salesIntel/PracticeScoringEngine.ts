import { callClaude, extractText } from '../claudeProxy';

export interface ScoringCategory {
  name: string;
  score: number;
  weakMoment: {
    timestamp: string;
    said: string;
    shouldHaveSaid: string;
  };
  note: string;
}

export interface ScoreRoundResult {
  categories: ScoringCategory[];
  overall: number;
  fillerCount: number;
  topStrength: string;
  topWeakness: string;
  oneThingToFix: string;
}

export interface WeakMomentReplay {
  startIndex: number;
  endIndex: number;
  said: string;
  shouldHaveSaid: string;
  category: string;
  pointsLost: number;
}

/**
 * Score a practice call transcript using Claude
 */
export async function scoreRound(
  transcript: string,
  scenario: string,
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
): Promise<ScoreRoundResult> {
  const systemPrompt = `Score this practice call transcript for an electrical contractor.
Scenario: ${scenario}. Difficulty: ${difficulty}.

Score each category 1-10:
1. OPENING: Did he introduce himself confidently? Reference a specific trigger?
2. OBJECTION HANDLING: Did he address pushback without caving? Hold price?
3. TECHNICAL DEPTH: Did he reference NEC codes, experience, specific knowledge?
4. CLOSING: Was there a clear next step? Did he ask for the business?
5. PACE: Speaking speed appropriate? Not rushing? Not too slow?
6. EMOTIONAL CONTROL: Any ego triggers? Discount reflex? Checkout language?
7. FILLER WORDS: Count of um, like, you know, basically, honestly, hopefully

For each category provide:
- Score (1-10)
- The specific transcript moment that earned or lost the most points
- What he should have said instead (side-by-side)

Output valid JSON only (no markdown, no backticks):
{
  "categories": [
    {
      "name": "OPENING",
      "score": 7,
      "weakMoment": {
        "timestamp": "00:15",
        "said": "Uh, hi, I'm here for the outlet thing",
        "shouldHaveSaid": "Good morning! I'm Chris with PowerOn Solutions, an electrical contractor in your area. I understand you've had an outlet issue—I'd like to help you get that sorted today."
      },
      "note": "Good energy but missed the confidence marker"
    }
  ],
  "overall": 68,
  "fillerCount": 7,
  "topStrength": "Clear technical reasoning about NEC compliance",
  "topWeakness": "Filler words during price discussion",
  "oneThingToFix": "Eliminate 'um' and 'uh' by pausing instead when thinking"
}`;

  const userPrompt = `Score this transcript:\n\n${transcript}`;

  try {
    const response = await callClaude({
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: systemPrompt,
      max_tokens: 2000,
    });

    const responseText = extractText(response);

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]) as ScoreRoundResult;
    return result;
  } catch (error) {
    console.error('Error scoring round:', error);
    throw error;
  }
}

/**
 * Extract and replay the weak moment from a transcript
 */
export function replayWeakMoment(
  transcript: string,
  weakMoment: { timestamp: string; said: string; shouldHaveSaid: string },
  category: string
): WeakMomentReplay {
  const lines = transcript.split('\n');
  let startIndex = 0;
  let endIndex = 0;
  let found = false;

  // Find the weak moment in the transcript
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(weakMoment.said.substring(0, 20))) {
      startIndex = i;
      // Find the end of this statement
      for (let j = i; j < lines.length && j < i + 5; j++) {
        if (
          lines[j].includes(weakMoment.said.substring(-20)) ||
          lines[j].includes('?') ||
          lines[j].includes('.')
        ) {
          endIndex = j;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  return {
    startIndex,
    endIndex: endIndex || startIndex,
    said: weakMoment.said,
    shouldHaveSaid: weakMoment.shouldHaveSaid,
    category,
    pointsLost: 3, // Estimated points lost per weak moment
  };
}

/**
 * Count filler words in transcript
 */
export function countFillerWords(transcript: string): number {
  const fillerPatterns = [
    /\bum\b/gi,
    /\buh\b/gi,
    /\blike\b/gi,
    /\byou know\b/gi,
    /\bbasically\b/gi,
    /\bhonestly\b/gi,
    /\bhopefully\b/gi,
  ];

  let count = 0;
  fillerPatterns.forEach((pattern) => {
    const matches = transcript.match(pattern);
    if (matches) count += matches.length;
  });

  return count;
}

export default {
  scoreRound,
  replayWeakMoment,
  countFillerWords,
};
