require('dotenv').config({})
import * as fs from 'fs'
import * as path from 'path'
import 'isomorphic-fetch'
import * as StellarSdk from 'stellar-sdk'
import { Keypair } from 'stellar-sdk'

interface AddOperationDelegate {
  (txBuilder: StellarSdk.TransactionBuilder): void;
}

interface LoadKeyPairResult {
  isNew: boolean;
  keyPair: StellarSdk.Keypair;
}

interface InitAccountResult {
  keyPair: StellarSdk.Keypair;
  account: StellarSdk.AccountResponse;
}

interface CreateAccountResult {
  keyPair: StellarSdk.Keypair;
  account: StellarSdk.AccountResponse;
}

interface AccountInfo {
  name: string;
  secretFilePath: string;
  keyPair: StellarSdk.Keypair | null;
  account: StellarSdk.AccountResponse | null;
}

interface AccountInfoDelegate {
  (accountInfo: AccountInfo): Promise<void>;
}

export const SECRET_FOLDER_NAME = 'secrets'
export const ISSUERS_KEY_FILE_NAME = 'issuer.key'
export const DISTRIBUTOR_KEY_FILE_NAME = 'dist.key'

/**
 * Create folder for store
 * key file
 */
 if (!fs.existsSync(path.join(__dirname, SECRET_FOLDER_NAME))) {
  fs.mkdirSync(path.join(__dirname, SECRET_FOLDER_NAME))
}

const secretFolderPath = path.join(__dirname, SECRET_FOLDER_NAME);
const issuerSecretFilePath = path.join(secretFolderPath, `/${ISSUERS_KEY_FILE_NAME}`);
const distributorSecretFilePath = path.join(secretFolderPath, `/${DISTRIBUTOR_KEY_FILE_NAME}`);

const wallets: AccountInfo[] = [
  { name: 'wallet1', secretFilePath: path.join(secretFolderPath, 'wallet1.key'), keyPair: null, account: null },
  { name: 'wallet2', secretFilePath: path.join(secretFolderPath, 'wallet2.key'), keyPair: null, account: null },
  { name: 'wallet3', secretFilePath: path.join(secretFolderPath, 'wallet3.key'), keyPair: null, account: null },
  { name: 'wallet4', secretFilePath: path.join(secretFolderPath, 'wallet4.key'), keyPair: null, account: null },
  { name: 'wallet5', secretFilePath: path.join(secretFolderPath, 'wallet5.key'), keyPair: null, account: null },
]

wallets.forEach((walletInfo) => console.log(`${walletInfo.name}`));

StellarSdk.Networks.TESTNET;
const server = new StellarSdk.Server('https://horizon-testnet.stellar.org')

async function run() {
  const { ASSET_NAME } = process.env
  if (ASSET_NAME) {
    const issuerInitResult = await initAccount('issuer', issuerSecretFilePath, server);
    const distributorInitResult = await initAccount('distributor', distributorSecretFilePath, server);

    const issuer = issuerInitResult.account;
    const issuerKey = issuerInitResult.keyPair;

    const distributor = distributorInitResult.account;
    const distributorKey = distributorInitResult.keyPair;

    console.log(`issuer.....:        id = ${issuer?.id}`);
    console.log(`issuer.....: publicKey = ${issuerKey.publicKey()}`);
    console.log('');
    console.log(`distributor:        id = ${distributor?.id}`);
    console.log(`distributor: publicKey = ${distributorKey.publicKey()}`);
    console.log('');

    console.log("initialize wallets...");
    
    // PARALLEL
    await Promise.all(wallets.map(async (walletInfo) => {
      const initResult = await initAccount(walletInfo.name, walletInfo.secretFilePath, server);

      walletInfo.account = initResult.account;
      walletInfo.keyPair = initResult.keyPair;

      if (walletInfo.keyPair != null && walletInfo.account != null) {
        console.log(`${walletInfo.name}:        id = ${walletInfo.account.id}`);
        console.log(`${walletInfo.name}: publicKey = ${walletInfo.keyPair.publicKey()}`);
        console.log('');
      }
    }));

    // SERIAL
    // for (const walletInfo of wallets) {
    //   const initResult = await initAccount(walletInfo.name, walletInfo.secretFilePath, server);

    //   walletInfo.account = initResult.account;
    //   walletInfo.keyPair = initResult.keyPair;

    //   if (walletInfo.keyPair != null && walletInfo.account != null) {
    //     console.log(`${walletInfo.name}:        id = ${walletInfo.account.id}`);
    //     console.log(`${walletInfo.name}: publicKey = ${walletInfo.keyPair.publicKey()}`);
    //     console.log('');
    //   }
    // }

    console.log("initialize wallets...");


    let execute = true;
    console.log(`${execute ? 'EXECUTE' : 'STOP!'}`);

    if (execute) {
      const AppAsset = new StellarSdk.Asset(ASSET_NAME, issuerKey.publicKey())

      //********************************************************
      // Lock our asset by setting an option
      // AUTHORIZATION REQUIRED flag
      // to issuer account
      //********************************************************
      await createSignAndSubmitTransaction(
        issuer, 
        issuerKey, 
        `issuer: setOptions(setFlags=AuthRequiredFlag)`, 
        (txBuilder) => {
          txBuilder.addOperation(
            StellarSdk.Operation.setOptions({
              setFlags: StellarSdk.AuthRequiredFlag
              // clearFlags: StellarSdk.AuthRequiredFlag
            })
          );
        }
      );


      //********************************************************
      // Change distributor trustline to trust issuer
      //********************************************************
      await createSignAndSubmitTransaction(
        distributor, 
        distributorKey, 
        `distributor: changeTrust(asset {code: '${AppAsset.code}', issuer: 'issuer'})`, 
        (txBuilder) => {
          txBuilder.addOperation(
            StellarSdk.Operation.changeTrust({
              asset: AppAsset
            })
          );
        }
      );


      //********************************************************
      // Change wallet trustline to trust issuer
      //********************************************************
      forEachWalletSeriell(async (walletInfo) => {
        if (walletInfo.keyPair != null && walletInfo.account != null) {
          await createSignAndSubmitTransaction(
            walletInfo.account, 
            walletInfo.keyPair, 
            `${walletInfo.name}: changeTrust(asset {code: '${AppAsset.code}', issuer: 'issuer'})`, 
            (txBuilder) => {
              txBuilder.addOperation(
                StellarSdk.Operation.changeTrust({
                  asset: AppAsset
                })
              );
            }
          );
        }
      });


      //********************************************************
      // Allow distributor to hold our custom asset
      //********************************************************
      await createSignAndSubmitTransaction(
        issuer, 
        issuerKey, 
        `issuer: allowTrust (assetCode='${ASSET_NAME}', authorize = true, trustor = 'distributor')`,
        (txBuilder) => {
          txBuilder.addOperation(
            StellarSdk.Operation.allowTrust({
              assetCode: ASSET_NAME,
              authorize: true,
              trustor: distributor.id
            })
          );
        }
      );


      //********************************************************
      // Issuing Asset to distributor
      //********************************************************
      await createSignAndSubmitTransaction(
        issuer, 
        issuerKey, 
        `issuer: payment(asset {code: '${AppAsset.code}', issuer: 'issuer'}, amount = '1000000', destination = 'distributor')`, 
        (txBuilder) => {
          txBuilder.addOperation(
            StellarSdk.Operation.payment({
              asset: AppAsset,
              amount: '1000000',
              destination: distributor.id
            })
          );
        }
      );

      await loadAndDumpAssetBalances('issuer', issuerKey);
      await loadAndDumpAssetBalances('distributor', distributorKey);

      forEachWalletSeriell(async (walletInfo) => {
        if (walletInfo.keyPair != null && walletInfo.account != null) {
          await loadAndDumpAssetBalances(walletInfo.name, walletInfo.keyPair);
        }
      });

      //********************************************************
      // Customer init wallet and account
      // and then try to add trustline without
      // authorization
      //********************************************************
      // const wallet = await createWalllet(server)
      // if (!wallet) {
      //   throw new Error('wallet is unavaliable => abort')
      // }

      
      //const walletKey = await getWalletKey()
      //console.log(`wallet.id=${wallet.id}, publicKey=${walletKey.publicKey()}`);


      //********************************************************
      // Try to send asset to customer
      // Distributor will fail at the first attempt to send
      // some asset to wallet
      //********************************************************
      // await createSignAndSubmitTransaction(
      //   distributor, 
      //   distributorKey, 
      //   `distributor: payment(asset {code: '${AppAsset.code}', issuer: 'issuer'}, amount = '20', destination = 'wallet')`, 
      //   (txBuilder) => {
      //     txBuilder.addOperation(
      //       StellarSdk.Operation.payment({
      //         asset: AppAsset,
      //         amount: '20',
      //         destination: wallet.id
      //       })
      //     );
      //   }
      // );


      //********************************************************
      // Allow wallet to hold our custom asset
      //********************************************************
      forEachWalletSeriell(async (walletInfo) => {
        if (walletInfo.keyPair != null && walletInfo.account != null) {
          await createSignAndSubmitTransaction(
            issuer, 
            issuerKey, 
            `issuer: allowTrust(assetCode = '${AppAsset.code}', authorize = true, trustor = '${walletInfo.name}')`, 
            (txBuilder) => {
              if (walletInfo.keyPair != null && walletInfo.account != null) {
                txBuilder.addOperation(
                  StellarSdk.Operation.allowTrust({
                    assetCode: AppAsset.code,
                    authorize: true,
                    trustor: walletInfo.account.id
                  })
                );
              }
            }
          );
        }
      });


      //********************************************************
      // and then ask distributor to
      // try to send Asset to wallet again
      //********************************************************
      forEachWalletSeriell(async (walletInfo) => {
        if (walletInfo.keyPair != null && walletInfo.account != null) {
          await createSignAndSubmitTransaction(
            distributor, 
            distributorKey, 
            `distributor: payment(asset = {code: '${AppAsset.code}', issuer: '${AppAsset.issuer}'}, amount = '20', destination = '${walletInfo.name}')`, 
            (txBuilder) => {
              if (walletInfo.keyPair != null && walletInfo.account != null) {
                txBuilder.addOperation(
                  StellarSdk.Operation.payment({
                    asset: AppAsset,
                    amount: '20',
                    destination: walletInfo.account.id
                  })
                );
              }
            }
          );
        }
      });


      await loadAndDumpAssetBalances('issuer', issuerKey);
      await loadAndDumpAssetBalances('distributor', distributorKey);

      forEachWalletSeriell(async (walletInfo) => {
        if (walletInfo.keyPair != null && walletInfo.account != null) {
          await loadAndDumpAssetBalances(walletInfo.name, walletInfo.keyPair);
        }
      });
    }
  } else {
    console.log('Asset name not found (process.env.ASSET_NAME)')
  }

  console.log('BYE BYE');
}

export async function loadAndDumpAssetBalances (accountName: string, keyPair: StellarSdk.Keypair): Promise<StellarSdk.AccountResponse> {
  const account = await server.loadAccount(keyPair.publicKey());
  dumpAssetBalances(accountName, keyPair, account);

  return account;
}

export function dumpAssetBalances(accountName: string, keyPair: StellarSdk.Keypair, account: StellarSdk.AccountResponse) {
  console.log("");
  console.log('============================================================================================');
  console.log(`${accountName} ${keyPair.publicKey()} asset balances:`);
  account.balances.forEach((asset) => {
    console.log(asset);
  });
  console.log('============================================================================================');
  console.log("");
}



export async function createSignAndSubmitTransaction (sourceAccount: StellarSdk.Account, signerKey: StellarSdk.Keypair, title: string, addOperationDelegate: AddOperationDelegate) {
  const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
  fee: "100",
  networkPassphrase: StellarSdk.Networks.TESTNET
  });

  addOperationDelegate(txBuilder);

  txBuilder.setTimeout(100);
  const transaction = txBuilder.build();

  // sign transaction
  transaction.sign(signerKey);

  // submit to server
  console.log(title);
  
  try {
    await server.submitTransaction(transaction);
  } catch (e) {
    console.log(`${title}: Exception occured for signer: ${signerKey.publicKey()}`);
    console.dir(e)
  }
};

export function loadKeyPair(accountName: string, secretFilePath: string): LoadKeyPairResult {
  var fileExists = fs.existsSync(secretFilePath);

  let isNew = false;
  let keyPair: StellarSdk.Keypair;
  if (!fileExists) {
    keyPair = StellarSdk.Keypair.random();
    fs.writeFileSync(secretFilePath, keyPair.secret());
    isNew = true;
  } else {
    const accountSecret = fs.readFileSync(secretFilePath).toString();
    keyPair = StellarSdk.Keypair.fromSecret(accountSecret);
  }

  return {
    isNew: isNew,
    keyPair: keyPair,
  };
}

export async function initAccount(accountName: string, secretFilePath: string, server: StellarSdk.Server): Promise<InitAccountResult> {
  console.log(`initAccount for '${accountName}' started...`);

  var loadKeyResult = loadKeyPair(accountName, secretFilePath);

  if (loadKeyResult.isNew) {
     if (process.env.NODE_ENV === 'development') {
      await fundAccount(accountName, loadKeyResult.keyPair);
    }
  }

  console.log(`initAccount for '${accountName}' fetch and dump asset balances...`);
  const account = await loadAndDumpAssetBalances(accountName, loadKeyResult.keyPair);
  console.log(`initAccount for '${accountName}' fetch and dump asset balances completed`);

  console.log(`initAccount for '${accountName}' completed`);
  return {
    keyPair: loadKeyResult.keyPair,
    account: account,
  };
}

export async function fundAccount(accountName: string, keyPair: StellarSdk.Keypair) {
  console.log(`${accountName}: calling friendbot to fund it... ${keyPair.publicKey()}`);
  
  await fetch(`https://friendbot.stellar.org/?addr=${keyPair.publicKey()}`, {})
  .then(() => {
    console.log(`${accountName}: funded`);
  })
}

export async function forEachWalletSeriell(run: AccountInfoDelegate) {
  for (const walletInfo of wallets) {
    console.log(`${walletInfo.name} run...`);
    await run(walletInfo);
    console.log(`${walletInfo.name} completed`);
  }
}

run();
