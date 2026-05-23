import * as deepl from "deepl-node";

const translator = new deepl.Translator(
  process.env.DEEPL_API_KEY
);

export async function translate(text, targetLang, sourceLang = null) {
  const result = await translator.translateText(
    text,
    sourceLang,
    targetLang
  );

  return result.text;
}