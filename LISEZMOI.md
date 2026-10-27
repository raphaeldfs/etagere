# Étagère

Mes documents rangés en classeurs, lus dans leur version originale, avec parties à valider et marque-pages.

## Mettre le site en ligne (une seule fois)

1. Sur github.com : **New repository** → nom `etagere` → **Public** → Create.
2. Dans le dépôt : **Add file › Upload files**, sélectionne **tous les fichiers** de ce dossier (il n'y a aucun sous-dossier), puis **Commit changes**.
3. **Settings › Pages** → Source : *Deploy from a branch* → Branch : `main` / `(root)` → Save.
4. Une minute plus tard, le site est en ligne à l'adresse `https://TON-PSEUDO.github.io/etagere/`.

## Synchroniser téléphone et ordinateur (une seule fois)

Tes documents et ta progression ne vont jamais dans ce dépôt public : ils vont dans un second dépôt, **privé**.

1. **New repository** → nom `etagere-donnees` → **Private** → coche *Add a README file* → Create.
2. Crée un jeton : photo de profil › **Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token**.
   - Expiration : 1 an (ou plus).
   - Repository access : *Only select repositories* → `etagere-donnees`.
   - Permissions › Repository permissions › **Contents : Read and write**.
   - Generate token, puis copie-le (il commence par `github_pat_`).
3. Sur l'ordinateur, ouvre le site → **Ajouter › Synchroniser mes appareils** → dépôt `TON-PSEUDO/etagere-donnees` + le jeton → Connecter.
4. Pour le téléphone : sur l'ordinateur, **Connecter un autre appareil** affiche un QR code. Vise-le avec l'appareil photo du téléphone.

## Installer l'appli

- **iPhone (Safari)** : bouton Partager › *Sur l'écran d'accueil*. L'appli installée a sa propre mémoire : ouvre-la, puis Ajouter › Synchroniser › *J'ai un code de connexion*, et colle le code copié depuis l'ordinateur (envoie-le-toi par message).
- **Android (Chrome)** : menu ⋮ › *Installer l'application*.
- **Ordinateur (Chrome ou Edge)** : icône d'installation à droite de la barre d'adresse.

## Mettre à jour

Remplace les fichiers du dépôt `etagere` par ceux de la nouvelle version (Upload files, mêmes noms). Tes documents et ta progression ne bougent pas.
