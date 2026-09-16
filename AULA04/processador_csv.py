import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("execucao_bot.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)


def processar_arquivo(caminho: str) -> None:
    try:
        with open(caminho, "r", encoding="utf-8") as arquivo:
            for numero_linha, linha in enumerate(arquivo, start=1):
                logging.info(f"Linha {numero_linha} lida: {linha.strip()}")
    except FileNotFoundError:
        logging.error(f"Arquivo não encontrado: {caminho}")
    finally:
        logging.info(f"Tentativa de processamento do arquivo '{caminho}' finalizada.")


if __name__ == "__main__":
    processar_arquivo("dados.csv")
    processar_arquivo("arquivo_inexistente.csv")
    
