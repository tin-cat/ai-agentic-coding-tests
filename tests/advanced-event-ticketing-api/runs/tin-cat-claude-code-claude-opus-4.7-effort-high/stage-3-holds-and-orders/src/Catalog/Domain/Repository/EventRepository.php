<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Repository;

use Frontstage\Catalog\Domain\Exception\EventNotFound;
use Frontstage\Catalog\Domain\Model\Event\Event;
use Frontstage\Catalog\Domain\Model\Event\EventId;

/**
 * Domain port for Event aggregate persistence. Adapters in the infrastructure
 * layer (Doctrine today, anything later) implement this interface. The
 * application layer depends only on this contract.
 */
interface EventRepository
{
	public function save(Event $event): void;

	/**
	 * @throws EventNotFound when no event matches the given id.
	 */
	public function get(EventId $id): Event;

	public function find(EventId $id): ?Event;
}
