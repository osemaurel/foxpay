-- Rattrapage de 0018.
--
-- Le quota est posé sur la commande à sa création : relever la valeur par
-- défaut n'a donc rien changé aux commandes déjà ouvertes, et 0018 n'avait
-- rattrapé que celles déjà payées. Une commande alors en attente, payée
-- depuis, est arrivée livrée avec l'ancien quota de trois — c'est arrivé le
-- jour même.
update public.orders set max_downloads = 10 where max_downloads < 10;
