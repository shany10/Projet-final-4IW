import { captureTrafficSource } from '~/utils/analytics'

// Capture l'origine du trafic (parametres UTM / ref) des l'arrivee sur le site,
// avant toute navigation interne qui effacerait ces parametres de l'URL. La
// valeur est conservee le temps de la session et rattachee aux evenements du
// tunnel de conversion (voir ~/utils/analytics).
export default defineNuxtPlugin(() => {
  captureTrafficSource()
})
