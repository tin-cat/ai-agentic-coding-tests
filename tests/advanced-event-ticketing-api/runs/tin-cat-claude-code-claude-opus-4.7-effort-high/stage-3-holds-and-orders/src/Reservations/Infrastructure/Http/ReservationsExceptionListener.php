<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Http;

use Frontstage\Reservations\Domain\Exception\EventUnknown;
use Frontstage\Reservations\Domain\Exception\HoldNotFound;
use Frontstage\Reservations\Domain\Exception\InvalidArgument;
use Frontstage\Reservations\Domain\Exception\SeatUnavailable;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\Messenger\Exception\HandlerFailedException;

/**
 * Translates Reservations domain exceptions thrown anywhere in a request into
 * the same JSON shape the Catalog context uses.
 */
#[AsEventListener]
final class ReservationsExceptionListener
{
	public function __invoke(ExceptionEvent $event): void
	{
		$throwable = $event->getThrowable();

		if ($throwable instanceof HandlerFailedException) {
			$nested = $throwable->getPrevious();
			if (null !== $nested) {
				$throwable = $nested;
			}
		}

		$response = match (true) {
			$throwable instanceof HoldNotFound => $this->error(Response::HTTP_NOT_FOUND, $throwable->getMessage()),
			$throwable instanceof EventUnknown => $this->error(Response::HTTP_NOT_FOUND, $throwable->getMessage()),
			$throwable instanceof InvalidArgument => $this->error(Response::HTTP_BAD_REQUEST, $throwable->getMessage()),
			$throwable instanceof SeatUnavailable => $this->error(Response::HTTP_CONFLICT, $throwable->getMessage()),
			default => null,
		};

		if (null !== $response) {
			$event->setResponse($response);
		}
	}

	private function error(int $status, string $message): JsonResponse
	{
		return new JsonResponse(['error' => $message], $status);
	}
}
