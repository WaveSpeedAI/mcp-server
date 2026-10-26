// How a prompt names its input media. Callers write "@image 1", "@video 1",
// "@audio 1" (the older "@image1" also works); each model documents its own
// way to refer to them, so before submitting we swap the caller's names for
// the model's. A subset of api-dashboard lib/prompt-refs.ts: the syntaxes of
// the models the generate/edit tools offer. Models that document none (the
// image models) get plain words ("Image 1").

export type PromptRefKind = 'image' | 'video' | 'audio';

/** One media input of a request, numbered per kind in the order models number them. */
export interface PromptRef {
  /** image1: the n-th image of the request, as the caller writes it. */
  label: string;
  kind: PromptRefKind;
  url: string;
  /** The model's documented name for it, or null when its docs define none. */
  name: string | null;
  /** A readable name for every input. */
  plain: string;
}

interface Syntax {
  tag: (kind: PromptRefKind, n: number) => string | null;
  /** The video being edited, when it is not simply the first video. */
  inputVideo?: string | null;
}

const word = (kind: PromptRefKind) => kind[0].toUpperCase() + kind.slice(1);

// Vendor docs, as researched for /chat on 2026-09-28.
const SYNTAXES: Array<[RegExp, Syntax]> = [
  [/^wavespeed-ai\/minimax-h3(-[a-z0-9]+)?\//, { tag: (k, n) => `<${k === 'image' ? 'Picture' : word(k)} ${n}>`, inputVideo: null }],
  [/^kwaivgi\/kling-v4\.0\/(reference-to-video|video-edit)/, { tag: (k, n) => `@${word(k)}${n}` }],
  [/^alibaba\/wan-3\.0/, { tag: (k, n) => `${word(k)} ${n}` }],
  [/^bytedance\/seedance-2\.[05]/, { tag: (k, n) => `@${word(k)} ${n}` }],
];

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The media of a request in the order models number them: the edited video, the image and reference lists, then the frames. */
export function promptRefs(input: Record<string, unknown>, modelId: string): PromptRef[] {
  const syntax = SYNTAXES.find(([pattern]) => pattern.test(modelId))?.[1];
  const refs: PromptRef[] = [];
  const labels = { image: 0, video: 0, audio: 0 };
  const counts = { image: 0, video: 0, audio: 0 };
  const plainCounts = { image: 0, video: 0, audio: 0 };
  const add = (url: unknown, kind: PromptRefKind, role?: { name?: string | null; plain?: string }) => {
    if (typeof url !== 'string' || !url || refs.some((r) => r.url === url)) return;
    labels[kind] += 1;
    let name: string | null;
    if (role && role.name !== undefined) name = role.name;
    else if (!syntax) name = null;
    else {
      counts[kind] += 1;
      name = syntax.tag(kind, counts[kind]);
    }
    const plain = role?.plain ?? `${word(kind)} ${++plainCounts[kind]}`;
    refs.push({ label: `${kind}${labels[kind]}`, kind, url, name, plain });
  };
  add(input.video, 'video', syntax && syntax.inputVideo !== undefined ? { name: syntax.inputVideo, plain: 'the input video' } : undefined);
  list(input.images).forEach((u) => add(u, 'image'));
  list(input.reference_images).forEach((u) => add(u, 'image'));
  list(input.reference_videos).concat(list(input.videos)).forEach((u) => add(u, 'video'));
  list(input.reference_audios).forEach((u) => add(u, 'audio'));
  list(input.audios).forEach((u) => add(u, 'audio'));
  add(input.image, 'image', { name: null, plain: 'the first frame' });
  add(input.last_image, 'image', { name: null, plain: 'the last frame' });
  return refs;
}

// "@image 1" or "@image1", in any case; "image1" without the @ is not a ref here.
const PROMPT_REF_PATTERN = /@(image|video|audio) ?(\d+)\b/gi;

/** Swap the caller's @image 1-style names for the model's documented terms (or plain words); refs the request does not carry stay as typed. */
export function renameRefs(prompt: string, input: Record<string, unknown>, modelId: string): string {
  const refs = new Map(promptRefs(input, modelId).map((r) => [r.label, r]));
  return prompt.replace(PROMPT_REF_PATTERN, (whole, kind: string, n: string) => {
    const ref = refs.get(`${kind.toLowerCase()}${n}`);
    return ref ? (ref.name ?? ref.plain) : whole;
  });
}
