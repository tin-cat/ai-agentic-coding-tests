<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Persistence\Doctrine;

use Doctrine\ORM\EntityManagerInterface;
use Frontstage\Catalog\Domain\Exception\EventNotFound;
use Frontstage\Catalog\Domain\Model\Event\Event;
use Frontstage\Catalog\Domain\Model\Event\EventId;
use Frontstage\Catalog\Domain\Repository\EventRepository;
use Frontstage\Catalog\Infrastructure\Persistence\Doctrine\Entity\DoctrineEvent;

/**
 * Doctrine ORM adapter for the {@see EventRepository} domain port.
 */
final class DoctrineEventRepository implements EventRepository
{
	public function __construct(
		private readonly EntityManagerInterface $em,
		private readonly EventMapper $mapper,
	) {
	}

	public function save(Event $event): void
	{
		$existing = $this->em->find(DoctrineEvent::class, $event->id->toString());
		$row = $this->mapper->toDoctrine($event, $existing);

		if (null === $existing) {
			$this->em->persist($row);
		}

		$this->em->flush();
	}

	public function get(EventId $id): Event
	{
		$event = $this->find($id);
		if (null === $event) {
			throw EventNotFound::withId($id);
		}

		return $event;
	}

	public function find(EventId $id): ?Event
	{
		$row = $this->em->find(DoctrineEvent::class, $id->toString());
		if (null === $row) {
			return null;
		}

		return $this->mapper->toDomain($row);
	}
}
