import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Ouvre chaque page en haut.
 *
 * Sans ça, quelqu'un qui a fait défiler une fiche produit jusqu'en bas arrive
 * sur le paiement au milieu du formulaire : le navigateur conserve la position
 * de défilement d'une page à l'autre, et l'acheteur ne voit jamais ce qu'il y
 * avait au-dessus.
 *
 * On ne le fait pas sur un retour arrière — là, l'acheteur s'attend à retrouver
 * l'endroit qu'il avait quitté, et le navigateur le restaure lui-même.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()
  const type = useNavigationType()

  useEffect(() => {
    if (type !== 'POP') window.scrollTo(0, 0)
    // Le chemin seul : changer un paramètre d'URL (?order=…) ne doit pas
    // renvoyer l'acheteur en haut pendant qu'il paie.
  }, [pathname, type])

  return null
}
