# Galerie photo — site statique complet

Un site à héberger tel quel sur **GitHub Pages** : galerie photo par
dossiers, journal, livre d'or (avec modération), formulaire de contact,
et gestion de fichiers — tout, y compris l'upload, se fait depuis le
navigateur, sans serveur.

## Sommaire

- `index.html` / `app.js` — le site public (galerie, journal, livre
  d'or, contact).
- `admin.html` / `admin.js` — l'espace propriétaire (upload photos,
  rédaction de notes, gestion de fichiers, modération, configuration).
- `style.css` — thème vert/gris, dégradés et animations, partagé par
  les deux pages.
- `photos.json`, `posts.json`, `guestbook.json`, `files.json` —
  manifestes de contenu, remplis automatiquement depuis l'admin.
- `site-config.json` — configuration publique (e-mail de contact,
  réglages du livre d'or).

## 1. Mettre le site en ligne

1. Dépôt GitHub **public** (requis pour Pages gratuit).
2. Tous les fichiers de ce dossier à la racine du dépôt.
3. **Settings → Pages → Deploy from a branch**, branche `main`, `/root`.
4. Le site est en ligne à `https://<compte>.github.io/<dépôt>/`.

## 2. Le jeton privé (pour toi, dans le coffre chiffré)

Sur `github.com/settings/personal-access-tokens` → **Fine-grained
token**, limité à ce dépôt, avec :
- **Contents : Read and write** (photos, notes, fichiers, manifestes)
- **Issues : Read and write** (modération du livre d'or)

Ce jeton est saisi une fois dans `admin.html`, chiffré avec ton mot de
passe, et ne quitte jamais ce navigateur en clair (voir la section
Sécurité).

## 3. Utiliser l'espace admin

Cinq onglets, une fois le coffre déverrouillé :

- **📷 Photos** — choisis un dossier (ou crée-en un), glisse des
  images. La case *"Optimiser avant envoi"* redimensionne et
  compresse chaque photo côté navigateur (max ~2000 px, JPEG 85 %)
  avant l'envoi — plus rapide, plus léger, désactivable si tu veux
  garder les fichiers originaux intacts. La **Bibliothèque** liste
  tout ce qui est publié, avec suppression.
- **📝 Notes** — un mini éditeur pour publier des textes façon journal
  (titre + texte). Bouton **Aperçu** pour voir exactement le rendu
  public avant de cliquer sur **Publier**. Liste et suppression en
  dessous.
- **📎 Fichiers** — comme les photos, mais pour n'importe quel type de
  fichier (PDF, texte, etc.), rangés par dossier dans `files/`.
- **💬 Livre d'or** — les messages envoyés depuis le site public
  arrivent ici en attente. **Publier** les ajoute au livre d'or public
  (`guestbook.json`) ; **Rejeter** les écarte. Rien n'apparaît sur le
  site sans passer par cette étape.
- **⚙️ Configuration** — adresse de contact publique (utilisée par le
  formulaire "Contact" du site) et activation du livre d'or public
  (voir juste en dessous). Un **aperçu complet du site** (compteurs de
  photos, notes, messages) y est aussi disponible à tout moment.

## 4. Activer le livre d'or public — à lire avant d'activer

Le livre d'or permet à **n'importe quel visiteur, sans compte**,
d'envoyer un message. Comme le site est statique, cela nécessite un
second jeton GitHub, **distinct de ton jeton privé**, embarqué **en
clair** dans `site-config.json` pour que le navigateur des visiteurs
puisse l'utiliser.

**Ce que tu dois faire :**

1. Crée un **second** jeton fin sur GitHub, limité à ce dépôt, avec
   la **seule** permission **Issues : Read and write**. Ne lui donne
   surtout pas "Contents".
2. Colle-le dans l'onglet **Configuration**, coche "Activer le livre
   d'or public", enregistre. L'admin te demande une confirmation
   explicite avant de l'écrire en clair dans le dépôt.

**Ce que ça implique, honnêtement :** ce jeton sera lisible par
absolument n'importe qui consultant le dépôt. Sa portée est
volontairement réduite au strict minimum : avec la seule permission
"Issues", quelqu'un de malveillant qui le récupère peut au pire créer
des issues (spam) dans ce dépôt — il ne peut ni lire ni modifier tes
photos, notes ou fichiers, ni toucher au code du site. Si ça arrive :
supprime les issues indésirables, régénère le jeton depuis GitHub
(l'ancien devient invalide instantanément), recolle le nouveau dans
la Configuration. Tu peux aussi désactiver le livre d'or à tout
moment en décochant la case.

Les messages passent tous par un filtre anti-spam basique côté
visiteur (champ piège invisible + une soumission toutes les 3
minutes par navigateur) et, surtout, par **ta modération manuelle**
avant toute publication publique.

## 5. Le formulaire de contact — vraiment privé

Contrairement au livre d'or, le formulaire "Contact" n'écrit rien
dans le dépôt : il ouvre simplement le client mail du visiteur avec
un message pré-rempli, adressé à l'e-mail que tu as renseigné dans
Configuration. Rien n'est stocké, rien n'est public — c'est le
visiteur qui envoie l'e-mail lui-même, avec sa propre messagerie.

## Sécurité — ce qui protège réellement l'espace admin

- **Chiffrement réel du coffre.** Compte, dépôt et jeton privé sont
  chiffrés en **AES-256-GCM**, clé dérivée du mot de passe par PBKDF2
  (250 000 itérations). Sans le mot de passe, rien n'est récupérable,
  même en lisant le code source.
- **Verrouillage anti-brute-force.** Chaque mot de passe erroné
  déclenche un délai croissant (2 s → 4 s → 8 s… jusqu'à 60 s).
- **Vérification du jeton** après déverrouillage : la page confirme
  auprès de GitHub que le jeton a bien les droits d'écriture attendus.
- **Verrouillage automatique** après 15 minutes d'inactivité.
- **CSP stricte** sur les deux pages (uniquement GitHub + Google
  Fonts autorisés).
- Le jeton privé déchiffré ne vit qu'en mémoire de session
  (`sessionStorage`) — disparaît à la fermeture de l'onglet ou via
  **Verrouiller**.

**Limites honnêtes :**
- Un mot de passe faible reste un mot de passe faible — le
  verrouillage temporaire freine la saisie manuelle, pas un calcul
  hors ligne. Choisis un mot de passe long et peu commun (l'indicateur
  de robustesse t'aide).
- Mot de passe oublié = pas de récupération (c'est le principe du
  chiffrement) : utilise "Oublié / réinitialiser" puis recrée un
  accès avec ton jeton GitHub.
- Le coffre chiffré vit uniquement dans **ce navigateur** — sur un
  autre appareil, il faut recréer un accès.
- Le jeton public du livre d'or (différent du jeton privé) est, par
  nature, visible de tous — voir section 4 pour ce que ça implique et
  comment en limiter les risques.

## Personnalisation

- Titre, sous-titre, navigation : `index.html`.
- Couleurs (vert/gris), dégradés, animations : variables et keyframes
  en haut de `style.css` (`:root`, `.orb`, `wordmark-shift`…).
- Tous les manifestes (`photos.json`, `posts.json`, `guestbook.json`,
  `files.json`) peuvent rester vides au départ — tout se remplit
  depuis l'espace admin.
