-- Le quota de téléchargements passe de 3 à 10.
--
-- Trois n'était pas un garde-fou contre le partage, c'était un piège. Le lien
-- s'ouvre le plus souvent dans le navigateur intégré de Facebook, WhatsApp ou
-- Gmail, qui n'enregistre pas toujours le fichier ; l'acheteur retape alors sur
-- le lien, et chaque tentative — réussie ou non — consommait un jeton. Sur les
-- commandes payées, dix-neuf sur cent trois étaient arrivées à 3/3, donc
-- refusées, souvent le jour même du paiement.
--
-- Dix laisse la place à ces tentatives ratées sans ouvrir la porte : passé ce
-- nombre, le lien reste inutilisable comme adresse de partage public. La vraie
-- protection tient de toute façon au jeton, imprévisible, et aux 7 jours.
alter table public.orders alter column max_downloads set default 10;

-- Les commandes payées dont le lien est encore ouvert profitent du nouveau
-- quota : ce sont exactement les acheteurs bloqués aujourd'hui.
update public.orders
set max_downloads = 10
where status = 'paid'
  and max_downloads = 3
  and download_expires_at > now();
