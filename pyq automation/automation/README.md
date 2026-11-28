# SSC PYQ automation (GitHub Actions)

Aapki `app.html` headless Chrome me chalti hai: PDF -> crop -> text/image pehchan -> AI se text + explanation -> image GitHub par
-> `mock/cgl/sets/<Category>_<N>.json` + `index.json`. Sab apne aap.

## Kaise chalta hai
- **Jab tak kaam aur key hai, lagataar chalta hai.** Ek run ~5 ghante ka hota hai; kaam baaki ho to wo khud agla run shuru kar deta hai.
- **Model**: app ki tarah — "Model list laao" -> "image padh sakte hain test karo" -> jo image padhte hain wahi pool. Pool ke andar app khud
  ek model ki limit khatam hone par dusre par jaati hai (bilkul app jaisa). Model ka naam daalne ki zaroorat nahi.
- **Key**: ek key chalti rehti hai. Uska balance/limit khatam hote hi (402/401 ya "insufficient balance / quota / daily limit" jaise jawab)
  wo usi paper ko agli key se shuru se karta hai. Adhura paper kabhi publish nahi hota.
- **Sab key khatam** -> `automation/state.json` me `pauseUntil` likh deta hai (agla subah 8:00 IST) aur ruk jata hai.
  Roz 8:00 IST ki schedule par naya din shuru; us din sab key phir se try hoti hain.
- Jo paper ho chuka (set ka naam `index.json` me hai) use dobara nahi karta. Jo paper fail ho (2 koshish ke baad) `state.json`
  me error ke saath atka rehta hai aur Actions ke Summary me dikhta hai.

## Key aur token KAHAN rakhna hai  (sabse zaroori)
**Kabhi bhi code, README, JSON ya chat me nahi.** Sirf GitHub Secrets me:
Repo -> Settings -> Secrets and variables -> Actions -> **New repository secret**
| Naam | Kya daalna hai |
|---|---|
| `AI_KEYS` | coarena ki sabhi keys, ek hi line me comma se: `key1,key2,key3,key4,key5` |
| `GH_PAT`  | GitHub token (fine-grained, sirf is repo ka, **Contents: Read and write**) |
Secrets daalne ke baad dikhte nahi, log me `***` ban jaate hain. Public repo hone par bhi koi inhe nahi dekh sakta.
(`GH_PAT` na daalo to workflow ka apna token use hoga; par GitHub Pages ka rebuild pakka karne ke liye `GH_PAT` behtar hai.)
Category ki image har year ki code me pehle se hai (2023=twentythree.png, 2022=twentytwo.png, 2021=twentyone.png, 2020=twenty.png). Badalni ho to Variable `CAT_IMAGES` = `2023=https://..png,2022=...`.

## Pehli baar
1. `automation/` aur `.github/` folder repo ke root me upload karo.
2. Secrets daalo (upar).
3. Actions -> "SSC PYQ automation" -> Run workflow: `only` = `2023-1`, `dry_run` = `1` (sirf test). Theek lage to khali chhodke chalao.
